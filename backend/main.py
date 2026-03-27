from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import time
import json
import httpx
import re
import uuid
from urllib.parse import quote
from reviewer import load_config, save_config, review_code_diff, review_code_diff_stream, review_code_diff_structured

# 导入数据库层
from database import (
    get_db, init_db,
    ProjectRepository, MergeRequestRepository,
    ReviewSessionRepository, ReviewCommentRepository
)
from models import ReviewStatus

# 初始化数据库
init_db()

app = FastAPI(title="LLM Code Review Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有域名进行跨域，或可以精确指定为 ["http://localhost:5173"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ReviewRequest(BaseModel):
    project_id: str | int
    mr_iid: int

class ConfigUpdateRequest(BaseModel):
    # 此处为简化版的接收全量配置，后续可切分成独立小模块
    config_data: dict

class UrlReviewRequest(BaseModel):
    url: str

class PublishNoteRequest(BaseModel):
    url: str
    new_path: str
    old_path: str | None = None
    new_line: int | None = None
    old_line: int | None = None
    comment: str
    base_sha: str
    head_sha: str
    start_sha: str
    comment_id: int | None = None  # 可选：用于更新发布状态
    comment: str
    base_sha: str
    head_sha: str
    start_sha: str

class PublishCommentByIdRequest(BaseModel):
    """通过评论 ID 发布评论到 GitLab"""
    comment_id: int

class SessionCommentsRequest(BaseModel):
    """保存会话评论的请求"""
    session_uuid: str
    comments: list  # List of {new_path, old_path, new_line, old_line, comment}


def execute_review_task(project_id: str | int, mr_iid: int):
    """后台执行实际审核任务，完成后发送评论到对应的 MR"""
    try:
        config = load_config()
        gl_config = config.get("gitlab", {})
        base_url = gl_config.get("url", "").rstrip("/")
        token = gl_config.get("private_token", "")
        if not base_url or not token or token == "CHANGEME":
            raise ValueError("GitLab 配置未设置或使用默认值")
        
        # 针对 project_id 可能是带 / 的路径字符串，先进行 url 编码
        encoded_project_id = quote(str(project_id), safe='')
        
        # 1. 组合获取 Changes 的 API 地址
        # 参考 Get-GitLabMRDiff.ps1: $baseUrl/api/v4/projects/$encodedProjectPath/merge_requests/$mrIid/changes
        api_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/changes"
        headers = {"PRIVATE-TOKEN": token}
        
        # 获取 MR 的 changes JSON
        resp = httpx.get(api_url, headers=headers, timeout=30.0)
        resp.raise_for_status()
        mr_data = resp.json()
        
        # 2. 保存到临时 JSON 文件（按照要求写入以供参考/作为记录）
        safe_project_name = str(project_id).replace("/", ".")
        temp_file_name = f"mr.diff.{safe_project_name}.{mr_iid}.{int(time.time())}.json"
        temp_path = os.path.join(os.getcwd(), temp_file_name) # 保存到当前工作目录，类似 ps1
        with open(temp_path, "w", encoding="utf-8") as f:
            json.dump(mr_data, f, ensure_ascii=False, indent=2)
            
        print(f"✅ 成功提取 MR diff 数据并保存至本地文件: {temp_path}")
        
        # 3. 提取变更内容组装给大模型
        diff_texts = []
        for change in mr_data.get("changes", []):
            new_path = change.get("new_path")
            diff = change.get("diff")
            # 简易组装：提取需要审查的 diff 内容
            diff_texts.append(f"文件路径: {new_path}\n变更内容:\n{diff}")
            
        full_diff_text = "\n---\n".join(diff_texts)
        
        # 4. 调用核心审查模块，将 diff 作为文本提示词传递
        review_report = review_code_diff(full_diff_text)
        
        # 5. 调用 GitLab API 发送评论回 MR
        notes_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/notes"
        post_resp = httpx.post(
            notes_url,
            headers=headers,
            json={"body": f"### 🤖 AI 代码审查报告 \n\n{review_report}"},
            timeout=30.0
        )
        post_resp.raise_for_status()
        
        print(f"✅ MR {mr_iid} 审查执行成功并且已提交评论")
        
    except httpx.HTTPStatusError as exc:
        print(f"❌ 审查任务请求 GitLab API 失败: HTTP {exc.response.status_code} - {exc.response.text}")
    except Exception as e:
        print(f"❌ 审查任务执行失败: {str(e)}")

@app.get("/")
def read_root():
    return {"message": "Welcome to LLM Code Review Agent API"}

@app.get("/api/config")
def get_current_config():
    """获取系统当前配置"""
    try:
        return load_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/config")
def update_current_config(req: ConfigUpdateRequest):
    """全量更新系统 TOML 配置"""
    try:
        save_config(req.config_data)
        return {"message": "配置更新成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/review/stream")
def trigger_review_stream(req: UrlReviewRequest):
    """流式返回代码审查结果，基于直接输入的 MR URL"""
    def generate_response():
        try:
            url = req.url.strip()
            # 1. 解析 URL 提取 Project ID 和 MR IID
            # ^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)
            match = re.match(r"^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)", url)
            if not match:
                yield f"data: {json.dumps({'status': 'error', 'message': '无效的 GitLab MR URL 格式。'})}\n\n"
                return
                
            base_url_from_url = match.group(1)
            project_path = match.group(2)
            mr_iid = match.group(3)
            
            yield f"data: {json.dumps({'status': 'info', 'message': '正在请求 GitLab 取回变更数据...'})}\n\n"
            
            config = load_config()
            gl_config = config.get("gitlab", {})
            token = gl_config.get("private_token", "")
            base_url = gl_config.get("url", base_url_from_url).rstrip("/")
            
            if not token or token == "CHANGEME":
                yield f"data: {json.dumps({'status': 'error', 'message': '未配置正确的 GitLab Private Token'})}\n\n"
                return
                
            encoded_project_id = quote(project_path, safe='')
            api_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/changes"
            headers = {"PRIVATE-TOKEN": token}
            
            # 发起请求
            resp = httpx.get(api_url, headers=headers, timeout=30.0)
            resp.raise_for_status()
            mr_data = resp.json()
            
            yield f"data: {json.dumps({'status': 'info', 'message': '代码获取成功，开始提交审查...'})}\n\n"
            
            # 解析 diff
            diff_texts = []
            for change in mr_data.get("changes", []):
                new_path = change.get("new_path")
                diff = change.get("diff")
                diff_texts.append(f"文件路径: {new_path}\n变更内容:\n{diff}")
                
            full_diff_text = "\n---\n".join(diff_texts)
            if not full_diff_text.strip():
                yield f"data: {json.dumps({'status': 'error', 'message': '该 MR 未包含任何有效代码变更！'})}\n\n"
                return
            
            # 流式审查
            full_report = ""
            for chunk in review_code_diff_stream(full_diff_text):
                full_report += chunk
                # 注意处理换行和转义，SSE 传输中 data 需进行 JSON 序列化
                yield f"data: {json.dumps({'status': 'streaming', 'chunk': chunk})}\n\n"
                
            # 执行回捞评论操作
            yield f"data: {json.dumps({'status': 'info', 'message': '\\n\\n✅ 审查完毕。正在将报告回评至 GitLab...'})}\n\n"
            
            notes_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/notes"
            post_resp = httpx.post(
                notes_url,
                headers=headers,
                json={"body": f"### 🤖 AI 代码审查报告 \n\n{full_report}"},
                timeout=30.0
            )
            post_resp.raise_for_status()
            
            yield f"data: {json.dumps({'status': 'done', 'message': '任务完全结束！'})}\n\n"
            
        except httpx.HTTPStatusError as exc:
            yield f"data: {json.dumps({'status': 'error', 'message': f'GitLab API 请求失败: HTTP {exc.response.status_code}'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': f'执行异常: {str(e)}'})}\n\n"

    return StreamingResponse(generate_response(), media_type="text/event-stream")

@app.post("/api/mr/diff")
def get_mr_diff(req: UrlReviewRequest):
    """获取 MR 的 Diff 数据和基本信息以便前端展示"""
    try:
        url = req.url.strip()
        match = re.match(r"^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)", url)
        if not match:
            raise HTTPException(status_code=400, detail="无效的 GitLab MR URL 格式。")
            
        base_url_from_url = match.group(1)
        project_path = match.group(2)
        mr_iid = match.group(3)
        
        config = load_config()
        gl_config = config.get("gitlab", {})
        token = gl_config.get("private_token", "")
        base_url = gl_config.get("url", base_url_from_url).rstrip("/")
        
        if not token or token == "CHANGEME":
            raise HTTPException(status_code=400, detail="未配置正确的 GitLab Private Token")
            
        encoded_project_id = quote(project_path, safe='')
        headers = {"PRIVATE-TOKEN": token}
        
        # 获取 MR 信息（包含了 diff_refs）
        mr_api_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}"
        resp_mr = httpx.get(mr_api_url, headers=headers, timeout=30.0)
        resp_mr.raise_for_status()
        mr_info = resp_mr.json()
        
        # 获取 MR Changes (diffs)
        changes_api_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/changes"
        resp_changes = httpx.get(changes_api_url, headers=headers, timeout=30.0)
        resp_changes.raise_for_status()
        changes_info = resp_changes.json()
        
        return {
            "project_id": project_path,
            "mr_iid": mr_iid,
            "diff_refs": mr_info.get("diff_refs"),
            "changes": changes_info.get("changes", [])
        }
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=f"GitLab API 请求失败: {exc.response.text}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取 MR 数据失败: {str(e)}")

@app.post("/api/review/structured_stream")
def trigger_review_structured_stream(req: UrlReviewRequest):
    """流式返回代码审查结果，输出为 JSON Lines，基于前端拉取的同一 MR URL。同时创建审查会话记录。"""
    db = get_db()
    project_repo = ProjectRepository(db)
    mr_repo = MergeRequestRepository(db)
    session_repo = ReviewSessionRepository(db)

    def generate_response():
        session = None
        try:
            url = req.url.strip()
            match = re.match(r"^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)", url)
            if not match:
                yield f"data: {json.dumps({'status': 'error', 'message': '无效的 GitLab MR URL 格式。'})}\n\n"
                return

            base_url_from_url = match.group(1)
            project_path = match.group(2)
            mr_iid = int(match.group(3))

            config = load_config()
            gl_config = config.get("gitlab", {})
            token = gl_config.get("private_token", "")
            base_url = gl_config.get("url", base_url_from_url).rstrip("/")
            llm_config = config.get("llm_config", {})

            if not token or token == "CHANGEME":
                yield f"data: {json.dumps({'status': 'error', 'message': '未配置正确的 GitLab Private Token'})}\n\n"
                return

            encoded_project_id = quote(project_path, safe='')
            api_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/changes"
            headers = {"PRIVATE-TOKEN": token}

            resp = httpx.get(api_url, headers=headers, timeout=30.0)
            resp.raise_for_status()
            mr_data = resp.json()

            # 创建或获取 Project 和 MR 记录
            project = project_repo.get_or_create(project_path)
            diff_refs = mr_data.get("diff_refs", {})
            mr_record = mr_repo.get_or_create(
                project_id=project['id'],
                mr_iid=mr_iid,
                title=mr_data.get('title'),
                source_branch=mr_data.get('source_branch'),
                target_branch=mr_data.get('target_branch'),
                author=mr_data.get('author', {}).get('username'),
                web_url=mr_data.get('web_url'),
                base_sha=diff_refs.get('base_sha'),
                head_sha=diff_refs.get('head_sha'),
                start_sha=diff_refs.get('start_sha')
            )

            # 准备 diff 内容
            diff_texts = []
            for change in mr_data.get("changes", []):
                new_path = change.get("new_path")
                old_path = change.get("old_path")
                diff = change.get("diff")
                diff_texts.append(f"旧路径: {old_path}\n新路径: {new_path}\n变更内容:\n{diff}")

            full_diff_text = "\n---\n".join(diff_texts)

            # 创建审查会话（保存 diff 快照）
            session = session_repo.create(
                mr_id=mr_record['id'],
                provider=llm_config.get('provider', 'openai'),
                model_name=llm_config.get('model_name', 'unknown'),
                diff_content=full_diff_text
            )
            session_uuid = session['session_uuid']

            # 返回 session_uuid 给前端
            yield f"data: {json.dumps({'status': 'info', 'session_uuid': session_uuid, 'message': '审查会话已创建'})}\n\n"

            # 更新会话状态为 streaming
            session_repo.update_status(session['id'], 'streaming')

            if not full_diff_text.strip():
                session_repo.update_status(session['id'], 'failed', error_message='该 MR 未包含任何有效代码变更')
                yield f"data: {json.dumps({'status': 'error', 'message': '该 MR 未包含任何有效代码变更！'})}\n\n"
                return

            # 流式审查，直接回传原始 chunk
            for chunk in review_code_diff_structured(full_diff_text):
                yield f"data: {json.dumps({'status': 'streaming', 'chunk': chunk})}\n\n"

            # 更新会话状态为 completed
            session_repo.update_status(session['id'], 'completed')
            yield f"data: {json.dumps({'status': 'done', 'session_uuid': session_uuid, 'message': '审查完成'})}\n\n"

        except httpx.HTTPStatusError as exc:
            if session:
                session_repo.update_status(session['id'], 'failed', error_message=f'GitLab API 错误: {exc.response.status_code}')
            yield f"data: {json.dumps({'status': 'error', 'message': f'GitLab API 请求失败: HTTP {exc.response.status_code}'})}\n\n"
        except Exception as e:
            if session:
                session_repo.update_status(session['id'], 'failed', error_message=str(e))
            yield f"data: {json.dumps({'status': 'error', 'message': f'执行异常: {str(e)}'})}\n\n"

    return StreamingResponse(generate_response(), media_type="text/event-stream")

@app.post("/api/mr/publish_note")
def publish_draft_note(req: PublishNoteRequest):
    """发布评论到 GitLab，并更新数据库中的发布状态"""
    db = get_db()
    comment_repo = ReviewCommentRepository(db)

    try:
        url = req.url.strip()
        match = re.match(r"^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)", url)
        if not match:
            raise HTTPException(status_code=400, detail="无效的 GitLab MR URL 格式。")

        base_url_from_url = match.group(1)
        project_path = match.group(2)
        mr_iid = match.group(3)

        config = load_config()
        gl_config = config.get("gitlab", {})
        token = gl_config.get("private_token", "")
        base_url = gl_config.get("url", base_url_from_url).rstrip("/")

        encoded_project_id = quote(project_path, safe='')
        headers = {"PRIVATE-TOKEN": token}

        # 直接使用 discussions API 进行行内评论
        discussion_url = f"{base_url}/api/v4/projects/{encoded_project_id}/merge_requests/{mr_iid}/discussions"
        discussion_payload = {
            "body": req.comment,
            "position": {
                "position_type": "text",
                "base_sha": req.base_sha,
                "head_sha": req.head_sha,
                "start_sha": req.start_sha,
                "new_path": req.new_path,
                "old_path": req.old_path or req.new_path,
                "new_line": req.new_line,
                "old_line": req.old_line
            }
        }

        resp_discussion = httpx.post(discussion_url, headers=headers, json=discussion_payload, timeout=30.0)
        resp_discussion.raise_for_status()
        result = resp_discussion.json()

        # 获取 discussion_id 和 note_id
        discussion_id = result.get('id')
        note_id = result.get('notes', [{}])[0].get('id') if result.get('notes') else None

        # 更新数据库中的发布状态
        if req.comment_id:
            comment_repo = ReviewCommentRepository(db)
            comment_repo.mark_published(
                req.comment_id,
                discussion_id,
                str(note_id) if note_id else None
            )

        return {
            "message": "评论应用成功",
            "discussion_id": discussion_id,
            "note_id": note_id
        }
    except httpx.HTTPStatusError as exc:
        # 记录发布失败
        if req.comment_id and comment_repo:
            comment_repo.mark_publish_failed(req.comment_id, f"HTTP {exc.response.status_code}")
        raise HTTPException(status_code=exc.response.status_code, detail=f"GitLab API Error: {exc.response.text}")
    except Exception as e:
        if req.comment_id and comment_repo:
            comment_repo.mark_publish_failed(req.comment_id, str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/review")
def trigger_review(req: ReviewRequest, background_tasks: BackgroundTasks):
    """手动触发代码审查（非阻塞）"""
    try:
        # 直接交给 FastAPI 自持的后台任务（实现同步响应，异步执行的效果）
        background_tasks.add_task(execute_review_task, req.project_id, req.mr_iid)
        return {"message": "审查任务已加入队列正在后台执行", "project_id": req.project_id, "mr_iid": req.mr_iid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 审查记录持久化 API
# ============================================================================

@app.post("/api/session/comments")
def save_session_comments(req: SessionCommentsRequest):
    """保存审查会话的评论到数据库"""
    try:
        db = get_db()
        session_repo = ReviewSessionRepository(db)
        comment_repo = ReviewCommentRepository(db)

        # 查找会话
        session = session_repo.find_by_uuid(req.session_uuid)
        if not session:
            raise HTTPException(status_code=404, detail="审查会话不存在")

        # 批量保存评论
        saved_comments = comment_repo.batch_create(session['id'], req.comments)

        return {
            "message": "评论保存成功",
            "session_id": session['id'],
            "count": len(saved_comments)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/comments/{comment_id}/publish")
def publish_comment_by_id(comment_id: int, req: PublishCommentByIdRequest = None):
    """发布指定评论到 GitLab，并更新数据库中的发布状态"""
    try:
        db = get_db()
        comment_repo = ReviewCommentRepository(db)
        session_repo = ReviewSessionRepository(db)
        mr_repo = MergeRequestRepository(db)

        # 获取评论及其关联信息
        comment_with_session = comment_repo.find_by_id_with_session(comment_id)
        if not comment_with_session:
            raise HTTPException(status_code=404, detail="评论不存在")

        if comment_with_session.get('gitlab_published'):
            raise HTTPException(status_code=400, detail="该评论已发布")

        # 获取 MR 信息
        session = session_repo.find_by_id(comment_with_session['session_id'])
        mr = mr_repo.find_by_id(session['mr_id'])

        config = load_config()
        gl_config = config.get("gitlab", {})
        token = gl_config.get("private_token", "")
        base_url = gl_config.get("url", "").rstrip("/")

        if not token or token == "CHANGEME":
            raise HTTPException(status_code=400, detail="未配置 GitLab Token")

        # 构建发布请求
        encoded_project_id = quote(mr['project_path'], safe='')
        # 需要从 projects 表获取 project_path
        from database import ProjectRepository
        project_repo = ProjectRepository(db)
        project = project_repo.find_by_id(mr['project_id'])

        discussion_url = f"{base_url}/api/v4/projects/{quote(project['project_path'], safe='')}/merge_requests/{mr['mr_iid']}/discussions"
        headers = {"PRIVATE-TOKEN": token}

        discussion_payload = {
            "body": comment_with_session['comment_text'],
            "position": {
                "position_type": "text",
                "base_sha": mr['base_sha'],
                "head_sha": mr['head_sha'],
                "start_sha": mr['start_sha'],
                "new_path": comment_with_session['new_path'],
                "old_path": comment_with_session.get('old_path') or comment_with_session['new_path'],
                "new_line": comment_with_session.get('new_line'),
                "old_line": comment_with_session.get('old_line')
            }
        }

        resp = httpx.post(discussion_url, headers=headers, json=discussion_payload, timeout=30.0)
        resp.raise_for_status()
        result = resp.json()

        # 更新评论的发布状态
        discussion_id = result.get('id')
        note_id = result.get('notes', [{}])[0].get('id') if result.get('notes') else None

        comment_repo.mark_published(comment_id, discussion_id, str(note_id) if note_id else None)

        return {
            "success": True,
            "comment_id": comment_id,
            "gitlab_discussion_id": discussion_id,
            "gitlab_note_id": note_id
        }
    except httpx.HTTPStatusError as exc:
        comment_repo.mark_publish_failed(comment_id, f"HTTP {exc.response.status_code}: {exc.response.text}")
        raise HTTPException(status_code=exc.response.status_code, detail=f"GitLab API 错误: {exc.response.text}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# 历史记录 API
# ============================================================================

@app.get("/api/history")
def get_review_history(limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    """获取审查历史记录列表"""
    try:
        db = get_db()
        session_repo = ReviewSessionRepository(db)

        sessions = session_repo.find_recent(limit=limit, offset=offset)

        return {
            "items": sessions,
            "limit": limit,
            "offset": offset,
            "total": len(sessions)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/history/{session_uuid}")
def get_review_history_detail(session_uuid: str):
    """获取指定审查会话的详细信息"""
    try:
        db = get_db()
        session_repo = ReviewSessionRepository(db)
        comment_repo = ReviewCommentRepository(db)
        mr_repo = MergeRequestRepository(db)
        project_repo = ProjectRepository(db)

        session = session_repo.find_by_uuid(session_uuid)
        if not session:
            raise HTTPException(status_code=404, detail="审查会话不存在")

        # 获取关联的 MR 和 Project
        mr = mr_repo.find_by_id(session['mr_id'])
        project = project_repo.find_by_id(mr['project_id']) if mr else None

        # 获取评论列表
        comments = comment_repo.find_by_session(session['id'])

        # 获取发布统计
        publish_stats = comment_repo.get_publish_stats(session['id'])

        return {
            "session": session,
            "project": project,
            "merge_request": mr,
            "comments": comments,
            "publish_stats": publish_stats
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/sessions/{session_uuid}/comments")
def get_session_comments(session_uuid: str):
    """获取指定会话的所有评论"""
    try:
        db = get_db()
        session_repo = ReviewSessionRepository(db)
        comment_repo = ReviewCommentRepository(db)

        session = session_repo.find_by_uuid(session_uuid)
        if not session:
            raise HTTPException(status_code=404, detail="审查会话不存在")

        comments = comment_repo.find_by_session(session['id'])
        publish_stats = comment_repo.get_publish_stats(session['id'])

        return {
            "session_uuid": session_uuid,
            "comments": comments,
            "publish_stats": publish_stats
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
