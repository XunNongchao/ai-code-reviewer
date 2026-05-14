"""评论管理路由"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.gitlab_service import GitLabClient
from services.review_service import get_gitlab_client, publish_comment_to_gitlab
from database import (
    get_db, ReviewSessionRepository, ReviewCommentRepository, ProjectRepository, MergeRequestRepository
)

router = APIRouter(prefix="/api", tags=["comments"])


class PublishNoteRequest(BaseModel):
    url: str
    new_path: str
    old_path: Optional[str] = None
    new_line: Optional[int] = None
    old_line: Optional[int] = None
    comment: str
    base_sha: str
    head_sha: str
    start_sha: str
    comment_id: Optional[int] = None


class SessionCommentsRequest(BaseModel):
    """保存会话评论的请求"""
    session_uuid: str
    comments: list


@router.post("/mr/publish_note")
def publish_draft_note(req: PublishNoteRequest):
    """发布评论到 GitLab 行内讨论，并更新数据库中的发布状态"""
    parsed = GitLabClient.parse_mr_url(req.url)
    if not parsed:
        raise HTTPException(status_code=400, detail="无效的 GitLab MR URL 格式。")

    db = get_db()
    comment_repo = ReviewCommentRepository(db)

    try:
        client = get_gitlab_client()
        result = publish_comment_to_gitlab(
            gitlab_client=client,
            project_path=parsed["project_path"],
            mr_iid=parsed["mr_iid"],
            comment_text=req.comment,
            new_path=req.new_path,
            old_path=req.old_path,
            new_line=req.new_line,
            old_line=req.old_line,
            base_sha=req.base_sha,
            head_sha=req.head_sha,
            start_sha=req.start_sha,
        )

        # 更新数据库中的发布状态
        if req.comment_id:
            comment_repo.mark_published(
                req.comment_id,
                result["discussion_id"],
                str(result["note_id"]) if result["note_id"] else None
            )

        return {
            "message": "评论应用成功",
            "discussion_id": result["discussion_id"],
            "note_id": result["note_id"],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if req.comment_id:
            comment_repo.mark_publish_failed(req.comment_id, str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/session/comments")
def save_session_comments(req: SessionCommentsRequest):
    """保存审查会话的评论到数据库"""
    db = get_db()
    session_repo = ReviewSessionRepository(db)
    comment_repo = ReviewCommentRepository(db)

    session = session_repo.find_by_uuid(req.session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="审查会话不存在")

    try:
        saved_comments = comment_repo.batch_create(session['id'], req.comments)
        return {
            "message": "评论保存成功",
            "session_id": session['id'],
            "count": len(saved_comments),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/comments/{comment_id}/publish")
def publish_comment_by_id(comment_id: int):
    """通过评论 ID 发布评论到 GitLab"""
    db = get_db()
    comment_repo = ReviewCommentRepository(db)
    session_repo = ReviewSessionRepository(db)
    mr_repo = MergeRequestRepository(db)
    project_repo = ProjectRepository(db)

    # 获取评论及其关联信息
    comment = comment_repo.find_by_id_with_session(comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    if comment.get('gitlab_published'):
        raise HTTPException(status_code=400, detail="该评论已发布")

    try:
        client = get_gitlab_client()
        project_path = comment['project_path']

        result = publish_comment_to_gitlab(
            gitlab_client=client,
            project_path=project_path,
            mr_iid=comment['mr_iid'] if 'mr_iid' in comment else None,
            comment_text=comment['comment_text'],
            new_path=comment['new_path'],
            old_path=comment.get('old_path'),
            new_line=comment.get('new_line'),
            old_line=comment.get('old_line'),
            base_sha=comment['base_sha'],
            head_sha=comment['head_sha'],
            start_sha=comment['start_sha'],
        )

        comment_repo.mark_published(
            comment_id,
            result["discussion_id"],
            str(result["note_id"]) if result["note_id"] else None
        )

        return {
            "success": True,
            "comment_id": comment_id,
            "gitlab_discussion_id": result["discussion_id"],
            "gitlab_note_id": result["note_id"],
        }
    except Exception as e:
        comment_repo.mark_publish_failed(comment_id, str(e))
        raise HTTPException(status_code=500, detail=str(e))
