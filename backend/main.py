from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import time
import json
import httpx
import re
from urllib.parse import quote
from reviewer import load_config, save_config, review_code_diff, review_code_diff_stream

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

@app.post("/api/review")
def trigger_review(req: ReviewRequest, background_tasks: BackgroundTasks):
    """手动触发代码审查（非阻塞）"""
    try:
        # 直接交给 FastAPI 自持的后台任务（实现同步响应，异步执行的效果）
        background_tasks.add_task(execute_review_task, req.project_id, req.mr_iid)
        return {"message": "审查任务已加入队列正在后台执行", "project_id": req.project_id, "mr_iid": req.mr_iid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
