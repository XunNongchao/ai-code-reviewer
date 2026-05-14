"""历史记录路由"""
import logging
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import List
from database import (
    get_db, ReviewSessionRepository, ReviewCommentRepository,
    MergeRequestRepository, ProjectRepository
)

logger = logging.getLogger("routers.history")
router = APIRouter(prefix="/api", tags=["history"])


@router.get("/history")
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
            "total": len(sessions),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history/{session_uuid}")
def get_review_history_detail(session_uuid: str):
    """获取指定审查会话的详细信息"""
    db = get_db()
    session_repo = ReviewSessionRepository(db)
    comment_repo = ReviewCommentRepository(db)
    mr_repo = MergeRequestRepository(db)
    project_repo = ProjectRepository(db)

    session = session_repo.find_by_uuid(session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="审查会话不存在")

    mr = mr_repo.find_by_id(session['mr_id'])
    project = project_repo.find_by_id(mr['project_id']) if mr else None
    comments = comment_repo.find_by_session(session['id'])
    publish_stats = comment_repo.get_publish_stats(session['id'])

    return {
        "session": session,
        "project": project,
        "merge_request": mr,
        "comments": comments,
        "publish_stats": publish_stats,
    }


@router.get("/sessions/{session_uuid}/comments")
def get_session_comments(session_uuid: str):
    """获取指定会话的所有评论"""
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
        "publish_stats": publish_stats,
    }


# ============================================================================
# 历史记录清理
# ============================================================================

class DeleteHistoryRequest(BaseModel):
    """删除指定历史记录"""
    session_uuids: List[str]


@router.delete("/history")
def delete_all_history():
    """清空所有历史记录（会话、评论级联删除）"""
    try:
        db = get_db()
        with db.get_connection() as conn:
            # 级联删除：comments -> sessions -> merge_requests -> projects
            conn.execute("DELETE FROM review_comments")
            conn.execute("DELETE FROM review_sessions")
            conn.execute("DELETE FROM merge_requests")
            conn.execute("DELETE FROM projects")
        logger.info("已清空所有历史记录")
        return {"message": "所有历史记录已清空"}
    except Exception as e:
        logger.error("清空历史记录失败: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/history/delete")
def delete_selected_history(req: DeleteHistoryRequest):
    """删除选中的历史记录"""
    if not req.session_uuids:
        raise HTTPException(status_code=400, detail="未选择任何记录")

    try:
        db = get_db()
        session_repo = ReviewSessionRepository(db)
        deleted_count = 0

        for uuid in req.session_uuids:
            session = session_repo.find_by_uuid(uuid)
            if session:
                with db.get_connection() as conn:
                    # 先删评论（级联应该自动处理，但显式删除更安全）
                    conn.execute("DELETE FROM review_comments WHERE session_id = ?", (session['id'],))
                    conn.execute("DELETE FROM review_sessions WHERE id = ?", (session['id'],))
                deleted_count += 1

        logger.info("已删除 %d 条历史记录", deleted_count)
        return {"message": f"已删除 {deleted_count} 条记录", "deleted_count": deleted_count}
    except Exception as e:
        logger.error("删除历史记录失败: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))
