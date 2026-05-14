"""
审查业务编排服务

负责协调 GitLab 数据拉取、LLM 调用、会话/评论持久化。
"""
import logging
from typing import Generator
from services.gitlab_service import GitLabClient
from database import (
    get_db, ProjectRepository, MergeRequestRepository,
    ReviewSessionRepository, ReviewCommentRepository
)
from reviewer import load_config, review_code_diff_structured, review_code_diff_stream, review_code_diff

logger = logging.getLogger("review_service")


def get_gitlab_client() -> GitLabClient:
    """根据当前配置创建 GitLab 客户端"""
    config = load_config()
    gl_config = config.get("gitlab", {})
    base_url = gl_config.get("url", "")
    token = gl_config.get("private_token", "")
    if not token or token == "CHANGEME":
        raise ValueError("未配置正确的 GitLab Private Token")
    logger.info("创建 GitLab 客户端: base_url=%s", base_url)
    return GitLabClient(base_url=base_url, private_token=token)


def build_diff_text(changes: list) -> str:
    """将 GitLab changes 列表拼接为 LLM 可读的 diff 文本"""
    diff_texts = []
    for change in changes:
        new_path = change.get("new_path")
        old_path = change.get("old_path")
        diff = change.get("diff")
        diff_texts.append(f"旧路径: {old_path}\n新路径: {new_path}\n变更内容:\n{diff}")
    return "\n---\n".join(diff_texts)


def create_review_session(project_path: str, mr_iid: int, mr_data: dict) -> dict:
    """
    创建审查会话记录（project + mr + session），返回 session dict。
    """
    db = get_db()
    project_repo = ProjectRepository(db)
    mr_repo = MergeRequestRepository(db)
    session_repo = ReviewSessionRepository(db)

    config = load_config()
    llm_config = config.get("llm_config", {})

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

    full_diff_text = build_diff_text(mr_data.get("changes", []))

    session = session_repo.create(
        mr_id=mr_record['id'],
        provider=llm_config.get('provider', 'openai'),
        model_name=llm_config.get('model_name', 'unknown'),
        diff_content=full_diff_text
    )

    logger.info("审查会话已创建: session_uuid=%s, project=%s, mr_iid=%d, diff_len=%d",
                session['session_uuid'], project_path, mr_iid, len(full_diff_text))
    return session


def stream_structured_review(diff_text: str) -> Generator[str, None, None]:
    """流式输出结构化审查结果（JSON Lines chunks）"""
    yield from review_code_diff_structured(diff_text)


def publish_comment_to_gitlab(
    gitlab_client: GitLabClient,
    project_path: str,
    mr_iid: int,
    comment_text: str,
    new_path: str,
    old_path: str,
    new_line: int | None,
    old_line: int | None,
    base_sha: str,
    head_sha: str,
    start_sha: str,
) -> dict:
    """发布单条评论到 GitLab 行内讨论，返回 {discussion_id, note_id}"""
    position = {
        "position_type": "text",
        "base_sha": base_sha,
        "head_sha": head_sha,
        "start_sha": start_sha,
        "new_path": new_path,
        "old_path": old_path or new_path,
        "new_line": new_line,
        "old_line": old_line,
    }
    result = gitlab_client.create_discussion(
        project_path=project_path,
        mr_iid=mr_iid,
        body=comment_text,
        position=position
    )
    discussion_id = result.get('id')
    note_id = result.get('notes', [{}])[0].get('id') if result.get('notes') else None
    return {"discussion_id": discussion_id, "note_id": note_id}
