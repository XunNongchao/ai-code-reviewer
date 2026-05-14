"""审查相关路由"""
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.gitlab_service import GitLabClient
from services.review_service import (
    get_gitlab_client, build_diff_text, create_review_session, stream_structured_review
)
from database import get_db, ReviewSessionRepository

logger = logging.getLogger("routers.review")
router = APIRouter(prefix="/api", tags=["review"])


class UrlReviewRequest(BaseModel):
    url: str


@router.post("/mr/diff")
def get_mr_diff(req: UrlReviewRequest):
    """获取 MR 的 Diff 数据和基本信息以便前端展示"""
    parsed = GitLabClient.parse_mr_url(req.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="无效的 GitLab MR URL 格式。")

    try:
        client = get_gitlab_client()
        project_path = parsed["project_path"]
        mr_iid = parsed["mr_iid"]

        logger.info("获取 MR diff: %s !%d", project_path, mr_iid)
        mr_info = client.get_merge_request(project_path, mr_iid)
        changes_info = client.get_merge_request_changes(project_path, mr_iid)

        return {
            "project_id": project_path,
            "mr_iid": mr_iid,
            "diff_refs": mr_info.get("diff_refs"),
            "changes": changes_info.get("changes", []),
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("获取 MR diff 失败: %s", str(e))
        raise HTTPException(status_code=500, detail=f"获取 MR 数据失败: {str(e)}")


@router.post("/review/structured_stream")
def trigger_review_structured_stream(req: UrlReviewRequest):
    """流式返回结构化代码审查结果（JSON Lines），同时创建审查会话记录。"""
    parsed = GitLabClient.parse_mr_url(req.url)
    if not parsed:
        # 直接在 generator 外返回错误
        def error_gen():
            yield f"data: {json.dumps({'status': 'error', 'message': '无效的 GitLab MR URL 格式。'})}\n\n"
        return StreamingResponse(error_gen(), media_type="text/event-stream")

    db = get_db()
    session_repo = ReviewSessionRepository(db)

    def generate_response():
        session = None
        try:
            project_path = parsed["project_path"]
            mr_iid = parsed["mr_iid"]

            client = get_gitlab_client()
            mr_data = client.get_merge_request_changes(project_path, mr_iid)

            # 创建审查会话
            session = create_review_session(project_path, mr_iid, mr_data)
            session_uuid = session['session_uuid']

            yield f"data: {json.dumps({'status': 'info', 'session_uuid': session_uuid, 'message': '审查会话已创建'})}\n\n"

            # 更新会话状态为 streaming
            session_repo.update_status(session['id'], 'streaming')

            full_diff_text = build_diff_text(mr_data.get("changes", []))
            if not full_diff_text.strip():
                session_repo.update_status(session['id'], 'failed', error_message='该 MR 未包含任何有效代码变更')
                yield f"data: {json.dumps({'status': 'error', 'message': '该 MR 未包含任何有效代码变更！'})}\n\n"
                return

            # 流式审查
            for chunk in stream_structured_review(full_diff_text):
                yield f"data: {json.dumps({'status': 'streaming', 'chunk': chunk})}\n\n"

            # 完成
            session_repo.update_status(session['id'], 'completed')
            yield f"data: {json.dumps({'status': 'done', 'session_uuid': session_uuid, 'message': '审查完成'})}\n\n"

        except ValueError as e:
            if session:
                session_repo.update_status(session['id'], 'failed', error_message=str(e))
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"
        except Exception as e:
            if session:
                session_repo.update_status(session['id'], 'failed', error_message=str(e))
            yield f"data: {json.dumps({'status': 'error', 'message': f'执行异常: {str(e)}'})}\n\n"

    return StreamingResponse(generate_response(), media_type="text/event-stream")
