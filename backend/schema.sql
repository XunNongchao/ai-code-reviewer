-- ============================================================================
-- SQLite Schema for AI Code Reviewer
-- Version: 1.0.0
-- ============================================================================

-- Enable WAL mode for concurrent access
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================================================
-- Configuration Tables
-- ============================================================================

-- LLM Provider credentials (supports multiple providers)
CREATE TABLE IF NOT EXISTS llm_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,           -- e.g., 'openai', 'anthropic', 'zhipu', 'custom'
    base_url TEXT,                       -- API base URL (nullable for some providers)
    api_key TEXT NOT NULL,               -- API key
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Active configuration settings (singleton row)
CREATE TABLE IF NOT EXISTS config_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- Singleton row
    active_provider TEXT NOT NULL DEFAULT 'openai',
    active_model TEXT NOT NULL DEFAULT 'gpt-4o-mini',
    gitlab_url TEXT NOT NULL DEFAULT 'https://gitlab.example.com',
    gitlab_token TEXT,                     -- GitLab private token
    default_prompt TEXT NOT NULL DEFAULT '你是一个代码审查专家。',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================
-- Review Session Tables
-- ============================================================================

-- Projects (GitLab projects that have been reviewed)
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_path TEXT NOT NULL UNIQUE,    -- e.g., 'group/project' or numeric ID
    gitlab_project_id TEXT,               -- GitLab's internal project ID
    name TEXT,                            -- Human readable name
    web_url TEXT,                         -- Project web URL
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Merge Requests
CREATE TABLE IF NOT EXISTS merge_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    mr_iid INTEGER NOT NULL,              -- GitLab MR IID (internal ID within project)
    mr_id TEXT,                           -- GitLab's global MR ID
    title TEXT,
    source_branch TEXT,
    target_branch TEXT,
    author TEXT,
    state TEXT DEFAULT 'opened',          -- opened, merged, closed
    web_url TEXT,
    base_sha TEXT,
    head_sha TEXT,
    start_sha TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(project_id, mr_iid),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Review Sessions (each review execution)
CREATE TABLE IF NOT EXISTS review_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id INTEGER NOT NULL,
    session_uuid TEXT NOT NULL UNIQUE,    -- UUID for external reference
    status TEXT NOT NULL DEFAULT 'pending', -- pending, streaming, completed, failed
    provider TEXT NOT NULL,               -- LLM provider used
    model_name TEXT NOT NULL,             -- Model used
    prompt_used TEXT,                     -- Full prompt sent to LLM
    diff_content TEXT,                    -- Raw diff content (optional, can be large)
    full_report TEXT,                     -- Complete review report (non-streaming)
    error_message TEXT,                   -- Error if failed
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,

    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);

-- ============================================================================
-- Review Comments Table
-- ============================================================================

-- Individual review comments
CREATE TABLE IF NOT EXISTS review_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    comment_uuid TEXT UNIQUE,             -- UUID for frontend reference

    -- File location
    new_path TEXT NOT NULL,               -- File path after change
    old_path TEXT,                        -- File path before change (for renames)
    new_line INTEGER,                     -- Line number in new file (nullable for deleted lines)
    old_line INTEGER,                     -- Line number in old file (nullable for new lines)

    -- Comment content
    comment_text TEXT NOT NULL,           -- The review comment/suggestion
    severity TEXT DEFAULT 'info',         -- info, warning, error, critical
    category TEXT,                        -- e.g., 'security', 'style', 'logic', 'performance'

    -- GitLab publishing status
    gitlab_published INTEGER NOT NULL DEFAULT 0,     -- Boolean: 0 = not published, 1 = published
    gitlab_discussion_id TEXT,           -- GitLab discussion ID after publishing
    gitlab_note_id TEXT,                 -- GitLab note ID
    published_at TEXT,                   -- When published to GitLab
    publish_error TEXT,                  -- Error message if publishing failed

    -- Metadata
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),

    FOREIGN KEY (session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_mr_project ON merge_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_mr_state ON merge_requests(state);
CREATE INDEX IF NOT EXISTS idx_sessions_mr ON review_sessions(mr_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON review_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON review_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_session ON review_comments(session_id);
CREATE INDEX IF NOT EXISTS idx_comments_published ON review_comments(gitlab_published);
CREATE INDEX IF NOT EXISTS idx_comments_path ON review_comments(new_path);
CREATE INDEX IF NOT EXISTS idx_provider_name ON llm_providers(name);

-- ============================================================================
-- Triggers for updated_at
-- ============================================================================

CREATE TRIGGER IF NOT EXISTS update_config_settings_timestamp
AFTER UPDATE ON config_settings
BEGIN
    UPDATE config_settings SET updated_at = datetime('now') WHERE id = 1;
END;

CREATE TRIGGER IF NOT EXISTS update_merge_requests_timestamp
AFTER UPDATE ON merge_requests
BEGIN
    UPDATE merge_requests SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_review_comments_timestamp
AFTER UPDATE ON review_comments
BEGIN
    UPDATE review_comments SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- ============================================================================
-- Initial Data
-- ============================================================================

-- Insert default config settings (singleton)
INSERT OR IGNORE INTO config_settings (id) VALUES (1);
