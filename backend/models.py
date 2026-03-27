"""
Pydantic data models for AI Code Reviewer
"""
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field
from enum import Enum
import uuid


class ReviewStatus(str, Enum):
    PENDING = "pending"
    STREAMING = "streaming"
    COMPLETED = "completed"
    FAILED = "failed"


class CommentSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class CommentCategory(str, Enum):
    SECURITY = "security"
    STYLE = "style"
    LOGIC = "logic"
    PERFORMANCE = "performance"
    DOCUMENTATION = "documentation"
    OTHER = "other"


# ============================================================================
# LLM Provider Models
# ============================================================================

class LLMProviderBase(BaseModel):
    name: str
    base_url: Optional[str] = None
    api_key: str


class LLMProviderCreate(LLMProviderBase):
    pass


class LLMProvider(LLMProviderBase):
    id: int
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ============================================================================
# Config Settings Models
# ============================================================================

class ConfigSettingsBase(BaseModel):
    active_provider: str = "openai"
    active_model: str = "gpt-4o-mini"
    gitlab_url: str = "https://gitlab.example.com"
    gitlab_token: Optional[str] = None
    default_prompt: str = "你是一个代码审查专家。"


class ConfigSettingsUpdate(BaseModel):
    active_provider: Optional[str] = None
    active_model: Optional[str] = None
    gitlab_url: Optional[str] = None
    gitlab_token: Optional[str] = None
    default_prompt: Optional[str] = None
    # 支持直接更新 provider 的 base_url 和 api_key
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class ConfigSettings(ConfigSettingsBase):
    id: int = 1
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ============================================================================
# Project Models
# ============================================================================

class ProjectBase(BaseModel):
    project_path: str
    gitlab_project_id: Optional[str] = None
    name: Optional[str] = None
    web_url: Optional[str] = None


class ProjectCreate(ProjectBase):
    pass


class Project(ProjectBase):
    id: int
    created_at: str

    class Config:
        from_attributes = True


# ============================================================================
# Merge Request Models
# ============================================================================

class MergeRequestBase(BaseModel):
    mr_iid: int
    mr_id: Optional[str] = None
    title: Optional[str] = None
    source_branch: Optional[str] = None
    target_branch: Optional[str] = None
    author: Optional[str] = None
    state: str = "opened"
    web_url: Optional[str] = None
    base_sha: Optional[str] = None
    head_sha: Optional[str] = None
    start_sha: Optional[str] = None


class MergeRequestCreate(MergeRequestBase):
    project_id: int


class MergeRequest(MergeRequestBase):
    id: int
    project_id: int
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ============================================================================
# Review Session Models
# ============================================================================

class ReviewSessionBase(BaseModel):
    provider: str
    model_name: str
    prompt_used: Optional[str] = None
    diff_content: Optional[str] = None


class ReviewSessionCreate(ReviewSessionBase):
    mr_id: int
    session_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()))


class ReviewSessionUpdate(BaseModel):
    status: Optional[ReviewStatus] = None
    full_report: Optional[str] = None
    error_message: Optional[str] = None
    completed_at: Optional[str] = None


class ReviewSession(ReviewSessionBase):
    id: int
    mr_id: int
    session_uuid: str
    status: ReviewStatus
    full_report: Optional[str]
    error_message: Optional[str]
    started_at: str
    completed_at: Optional[str]

    class Config:
        from_attributes = True


# ============================================================================
# Review Comment Models
# ============================================================================

class ReviewCommentBase(BaseModel):
    new_path: str
    old_path: Optional[str] = None
    new_line: Optional[int] = None
    old_line: Optional[int] = None
    comment_text: str
    severity: CommentSeverity = CommentSeverity.INFO
    category: Optional[CommentCategory] = None


class ReviewCommentCreate(ReviewCommentBase):
    session_id: int
    comment_uuid: Optional[str] = Field(default_factory=lambda: str(uuid.uuid4()))


class ReviewCommentUpdate(BaseModel):
    gitlab_published: Optional[bool] = None
    gitlab_discussion_id: Optional[str] = None
    gitlab_note_id: Optional[str] = None
    published_at: Optional[str] = None
    publish_error: Optional[str] = None


class ReviewComment(ReviewCommentBase):
    id: int
    session_id: int
    comment_uuid: Optional[str]
    gitlab_published: bool
    gitlab_discussion_id: Optional[str]
    gitlab_note_id: Optional[str]
    published_at: Optional[str]
    publish_error: Optional[str]
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


# ============================================================================
# API Response Models
# ============================================================================

class ReviewSessionWithComments(ReviewSession):
    """Review session with all associated comments"""
    comments: List[ReviewComment] = []
    project: Optional[Project] = None
    merge_request: Optional[MergeRequest] = None


class PublishResult(BaseModel):
    """Result of publishing a comment to GitLab"""
    success: bool
    comment_id: int
    gitlab_discussion_id: Optional[str] = None
    gitlab_note_id: Optional[str] = None
    error: Optional[str] = None


class HistoryListItem(BaseModel):
    """历史记录列表项"""
    session_id: int
    session_uuid: str
    status: ReviewStatus
    provider: str
    model_name: str
    started_at: str
    completed_at: Optional[str]
    project_path: str
    mr_iid: int
    mr_title: Optional[str]
    comment_count: int
    published_count: int


class HistoryDetail(BaseModel):
    """历史记录详情"""
    session: ReviewSession
    project: Optional[Project] = None
    merge_request: Optional[MergeRequest] = None
    comments: List[ReviewComment] = []
    publish_stats: dict = {"total": 0, "published": 0, "failed": 0}
