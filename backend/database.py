"""
SQLite database connection and repository layer for AI Code Reviewer
"""
import sqlite3
import os
from contextlib import contextmanager
from typing import Optional, List, Dict, Any
from datetime import datetime
import uuid


class DatabaseConfig:
    """Database configuration"""
    DB_DIR = os.path.join(os.path.dirname(__file__), "data")
    DB_PATH = os.path.join(DB_DIR, "code_reviewer.db")

    @classmethod
    def ensure_db_dir(cls):
        """Ensure database directory exists"""
        os.makedirs(cls.DB_DIR, exist_ok=True)


class DatabaseConnection:
    """SQLite database connection manager with WAL mode support"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or DatabaseConfig.DB_PATH
        DatabaseConfig.ensure_db_dir()
        self._initialize_db()

    @contextmanager
    def get_connection(self):
        """Get a database connection with proper configuration"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        # Enable WAL mode for concurrent access
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _initialize_db(self):
        """Initialize database schema"""
        with self.get_connection() as conn:
            schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
            if os.path.exists(schema_path):
                with open(schema_path, "r", encoding="utf-8") as f:
                    conn.executescript(f.read())


# Singleton database instance
_db: Optional[DatabaseConnection] = None


def get_db() -> DatabaseConnection:
    """Get database singleton"""
    global _db
    if _db is None:
        _db = DatabaseConnection()
    return _db


def init_db():
    """Initialize database (call this at startup)"""
    return get_db()


# ============================================================================
# Base Repository
# ============================================================================

class BaseRepository:
    """Base repository with common CRUD operations"""

    def __init__(self, db: DatabaseConnection, table_name: str):
        self.db = db
        self.table_name = table_name

    def _row_to_dict(self, row: sqlite3.Row) -> Optional[Dict[str, Any]]:
        """Convert a sqlite3.Row to dictionary"""
        return dict(row) if row else None

    def find_by_id(self, id: int) -> Optional[Dict[str, Any]]:
        """Find a record by ID"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                f"SELECT * FROM {self.table_name} WHERE id = ?", (id,)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def find_all(self, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
        """Find all records with pagination"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                f"SELECT * FROM {self.table_name} LIMIT ? OFFSET ?", (limit, offset)
            )
            return [self._row_to_dict(row) for row in cursor.fetchall()]

    def delete(self, id: int) -> bool:
        """Delete a record by ID"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                f"DELETE FROM {self.table_name} WHERE id = ?", (id,)
            )
            return cursor.rowcount > 0

    def count(self) -> int:
        """Count total records"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(f"SELECT COUNT(*) FROM {self.table_name}")
            return cursor.fetchone()[0]


# ============================================================================
# Config Repository
# ============================================================================

class ConfigRepository(BaseRepository):
    """Repository for configuration settings"""

    def __init__(self, db: DatabaseConnection = None):
        super().__init__(db or get_db(), "config_settings")

    def get_settings(self) -> Dict[str, Any]:
        """Get current settings (singleton row)"""
        with self.db.get_connection() as conn:
            cursor = conn.execute("SELECT * FROM config_settings WHERE id = 1")
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def update_settings(self, **kwargs) -> bool:
        """Update settings"""
        allowed_fields = {
            'active_provider', 'active_model', 'gitlab_url',
            'gitlab_token', 'default_prompt'
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed_fields and v is not None}

        if not updates:
            return False

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values())

        with self.db.get_connection() as conn:
            cursor = conn.execute(
                f"UPDATE config_settings SET {set_clause} WHERE id = 1",
                values
            )
            return cursor.rowcount > 0


class LLMProviderRepository(BaseRepository):
    """Repository for LLM providers"""

    def __init__(self, db: DatabaseConnection = None):
        super().__init__(db or get_db(), "llm_providers")

    def find_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Find provider by name"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM llm_providers WHERE name = ?", (name,)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def upsert(self, name: str, base_url: str = None, api_key: str = None) -> int:
        """Insert or update a provider"""
        with self.db.get_connection() as conn:
            existing = conn.execute(
                "SELECT id FROM llm_providers WHERE name = ?", (name,)
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE llm_providers SET base_url = ?, api_key = ?, updated_at = ? WHERE name = ?",
                    (base_url, api_key, datetime.now().isoformat(), name)
                )
                return existing[0]
            else:
                cursor = conn.execute(
                    "INSERT INTO llm_providers (name, base_url, api_key) VALUES (?, ?, ?)",
                    (name, base_url, api_key)
                )
                return cursor.lastrowid

    def delete_by_name(self, name: str) -> bool:
        """Delete provider by name"""
        with self.db.get_connection() as conn:
            cursor = conn.execute("DELETE FROM llm_providers WHERE name = ?", (name,))
            return cursor.rowcount > 0


# ============================================================================
# Project & MR Repository
# ============================================================================

class ProjectRepository(BaseRepository):
    """Repository for GitLab projects"""

    def __init__(self, db: DatabaseConnection = None):
        super().__init__(db or get_db(), "projects")

    def find_by_path(self, project_path: str) -> Optional[Dict[str, Any]]:
        """Find project by path"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM projects WHERE project_path = ?", (project_path,)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def get_or_create(self, project_path: str, **kwargs) -> Dict[str, Any]:
        """Get existing or create new project"""
        existing = self.find_by_path(project_path)
        if existing:
            return existing

        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO projects (project_path, gitlab_project_id, name, web_url)
                   VALUES (?, ?, ?, ?)""",
                (project_path, kwargs.get('gitlab_project_id'),
                 kwargs.get('name'), kwargs.get('web_url'))
            )
            last_id = cursor.lastrowid
            if not last_id:
                raise RuntimeError(f"Failed to insert project: {project_path}")

        result = self.find_by_id(last_id)
        if not result:
            raise RuntimeError(f"Failed to find inserted project with id: {last_id}")
        return result


class MergeRequestRepository(BaseRepository):
    """Repository for merge requests"""

    def __init__(self, db: DatabaseConnection = None):
        super().__init__(db or get_db(), "merge_requests")

    def find_by_project_and_iid(self, project_id: int, mr_iid: int) -> Optional[Dict[str, Any]]:
        """Find MR by project and IID"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM merge_requests WHERE project_id = ? AND mr_iid = ?",
                (project_id, mr_iid)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def get_or_create(self, project_id: int, mr_iid: int, **kwargs) -> Dict[str, Any]:
        """Get existing or create new MR"""
        existing = self.find_by_project_and_iid(project_id, mr_iid)
        if existing:
            # Update SHAs if provided
            if kwargs.get('base_sha') or kwargs.get('head_sha') or kwargs.get('start_sha'):
                self._update_shas(existing['id'], **kwargs)
            return existing

        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO merge_requests
                   (project_id, mr_iid, mr_id, title, source_branch, target_branch,
                    author, state, web_url, base_sha, head_sha, start_sha)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (project_id, mr_iid, kwargs.get('mr_id'), kwargs.get('title'),
                 kwargs.get('source_branch'), kwargs.get('target_branch'),
                 kwargs.get('author'), kwargs.get('state', 'opened'),
                 kwargs.get('web_url'), kwargs.get('base_sha'),
                 kwargs.get('head_sha'), kwargs.get('start_sha'))
            )
            last_id = cursor.lastrowid
            if not last_id:
                raise RuntimeError(f"Failed to insert MR: project_id={project_id}, mr_iid={mr_iid}")

        result = self.find_by_id(last_id)
        if not result:
            raise RuntimeError(f"Failed to find inserted MR with id: {last_id}")
        return result

    def _update_shas(self, mr_id: int, **kwargs):
        """Update MR SHA references"""
        updates = {}
        if kwargs.get('base_sha'):
            updates['base_sha'] = kwargs['base_sha']
        if kwargs.get('head_sha'):
            updates['head_sha'] = kwargs['head_sha']
        if kwargs.get('start_sha'):
            updates['start_sha'] = kwargs['start_sha']

        if not updates:
            return

        set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [mr_id]

        with self.db.get_connection() as conn:
            conn.execute(
                f"UPDATE merge_requests SET {set_clause} WHERE id = ?",
                values
            )


# ============================================================================
# Review Session Repository
# ============================================================================

class ReviewSessionRepository(BaseRepository):
    """Repository for review sessions"""

    def __init__(self, db: DatabaseConnection = None):
        super().__init__(db or get_db(), "review_sessions")

    def create(self, mr_id: int, provider: str, model_name: str,
               session_uuid: str = None, prompt_used: str = None,
               diff_content: str = None) -> Dict[str, Any]:
        """Create a new review session"""
        session_uuid = session_uuid or str(uuid.uuid4())

        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO review_sessions
                   (mr_id, session_uuid, status, provider, model_name, prompt_used, diff_content)
                   VALUES (?, ?, 'pending', ?, ?, ?, ?)""",
                (mr_id, session_uuid, provider, model_name, prompt_used, diff_content)
            )
            last_id = cursor.lastrowid
            if not last_id:
                raise RuntimeError(f"Failed to insert review session for mr_id: {mr_id}")

        result = self.find_by_id(last_id)
        if not result:
            raise RuntimeError(f"Failed to find inserted session with id: {last_id}")
        return result

    def update_status(self, session_id: int, status: str,
                      full_report: str = None, error_message: str = None):
        """Update session status"""
        with self.db.get_connection() as conn:
            if status == 'completed':
                conn.execute(
                    """UPDATE review_sessions
                       SET status = ?, full_report = ?, completed_at = ?
                       WHERE id = ?""",
                    (status, full_report, datetime.now().isoformat(), session_id)
                )
            elif status == 'failed':
                conn.execute(
                    """UPDATE review_sessions
                       SET status = ?, error_message = ?, completed_at = ?
                       WHERE id = ?""",
                    (status, error_message, datetime.now().isoformat(), session_id)
                )
            else:
                conn.execute(
                    "UPDATE review_sessions SET status = ? WHERE id = ?",
                    (status, session_id)
                )

    def find_by_uuid(self, session_uuid: str) -> Optional[Dict[str, Any]]:
        """Find session by UUID"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM review_sessions WHERE session_uuid = ?", (session_uuid,)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def find_by_mr(self, mr_id: int, limit: int = 10) -> List[Dict[str, Any]]:
        """Find all sessions for an MR"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """SELECT * FROM review_sessions
                   WHERE mr_id = ?
                   ORDER BY started_at DESC LIMIT ?""",
                (mr_id, limit)
            )
            return [self._row_to_dict(row) for row in cursor.fetchall()]

    def find_recent(self, limit: int = 20, offset: int = 0) -> List[Dict[str, Any]]:
        """Find recent sessions with project and MR info"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """SELECT
                    rs.id as session_id,
                    rs.session_uuid,
                    rs.status,
                    rs.provider,
                    rs.model_name,
                    rs.started_at,
                    rs.completed_at,
                    p.project_path,
                    p.name as project_name,
                    mr.mr_iid,
                    mr.title as mr_title,
                    (SELECT COUNT(*) FROM review_comments WHERE session_id = rs.id) as comment_count,
                    (SELECT COUNT(*) FROM review_comments WHERE session_id = rs.id AND gitlab_published = 1) as published_count
                   FROM review_sessions rs
                   JOIN merge_requests mr ON rs.mr_id = mr.id
                   JOIN projects p ON mr.project_id = p.id
                   ORDER BY rs.started_at DESC
                   LIMIT ? OFFSET ?""",
                (limit, offset)
            )
            return [self._row_to_dict(row) for row in cursor.fetchall()]


# ============================================================================
# Review Comment Repository
# ============================================================================

class ReviewCommentRepository(BaseRepository):
    """Repository for review comments"""

    def __init__(self, db: DatabaseConnection = None):
        super().__init__(db or get_db(), "review_comments")

    def create(self, session_id: int, new_path: str, comment_text: str,
               old_path: str = None, new_line: int = None, old_line: int = None,
               severity: str = 'info', category: str = None,
               comment_uuid: str = None) -> Dict[str, Any]:
        """Create a new review comment"""
        comment_uuid = comment_uuid or str(uuid.uuid4())

        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """INSERT INTO review_comments
                   (session_id, comment_uuid, new_path, old_path, new_line, old_line,
                    comment_text, severity, category)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (session_id, comment_uuid, new_path, old_path, new_line, old_line,
                 comment_text, severity, category)
            )
            return self.find_by_id(cursor.lastrowid)

    def batch_create(self, session_id: int, comments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Batch create comments"""
        results = []
        for comment in comments:
            result = self.create(
                session_id=session_id,
                new_path=comment.get('new_path', ''),
                comment_text=comment.get('comment', ''),
                old_path=comment.get('old_path'),
                new_line=comment.get('new_line'),
                old_line=comment.get('old_line'),
                severity=comment.get('severity', 'info'),
                category=comment.get('category')
            )
            results.append(result)
        return results

    def find_by_session(self, session_id: int) -> List[Dict[str, Any]]:
        """Find all comments for a session"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """SELECT * FROM review_comments
                   WHERE session_id = ?
                   ORDER BY new_path, new_line""",
                (session_id,)
            )
            return [self._row_to_dict(row) for row in cursor.fetchall()]

    def find_unpublished(self, session_id: int) -> List[Dict[str, Any]]:
        """Find unpublished comments for a session"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """SELECT * FROM review_comments
                   WHERE session_id = ? AND gitlab_published = 0
                   ORDER BY new_path, new_line""",
                (session_id,)
            )
            return [self._row_to_dict(row) for row in cursor.fetchall()]

    def mark_published(self, comment_id: int, discussion_id: str, note_id: str = None) -> bool:
        """Mark a comment as published to GitLab"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """UPDATE review_comments
                   SET gitlab_published = 1,
                       gitlab_discussion_id = ?,
                       gitlab_note_id = ?,
                       published_at = ?
                   WHERE id = ?""",
                (discussion_id, note_id, datetime.now().isoformat(), comment_id)
            )
            return cursor.rowcount > 0

    def mark_publish_failed(self, comment_id: int, error: str) -> bool:
        """Mark that publishing failed"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """UPDATE review_comments
                   SET publish_error = ?
                   WHERE id = ?""",
                (error, comment_id)
            )
            return cursor.rowcount > 0

    def find_by_uuid(self, comment_uuid: str) -> Optional[Dict[str, Any]]:
        """Find comment by UUID"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                "SELECT * FROM review_comments WHERE comment_uuid = ?", (comment_uuid,)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)

    def get_publish_stats(self, session_id: int) -> Dict[str, int]:
        """Get publishing statistics for a session"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN gitlab_published = 1 THEN 1 ELSE 0 END) as published,
                    SUM(CASE WHEN publish_error IS NOT NULL AND publish_error != '' THEN 1 ELSE 0 END) as failed
                   FROM review_comments
                   WHERE session_id = ?""",
                (session_id,)
            )
            row = cursor.fetchone()
            return {
                'total': row[0] or 0,
                'published': row[1] or 0,
                'failed': row[2] or 0
            }

    def find_by_id_with_session(self, comment_id: int) -> Optional[Dict[str, Any]]:
        """Find comment with session info for publishing"""
        with self.db.get_connection() as conn:
            cursor = conn.execute(
                """SELECT rc.*, rs.provider, rs.model_name,
                          mr.base_sha, mr.head_sha, mr.start_sha,
                          p.project_path
                   FROM review_comments rc
                   JOIN review_sessions rs ON rc.session_id = rs.id
                   JOIN merge_requests mr ON rs.mr_id = mr.id
                   JOIN projects p ON mr.project_id = p.id
                   WHERE rc.id = ?""",
                (comment_id,)
            )
            row = cursor.fetchone()
            return self._row_to_dict(row)
