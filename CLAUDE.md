# CLAUDE.md

AI Code Reviewer 的 Claude Code 开发指南。

## 项目概述

GitLab MR 代码审查智能体，前后端分离架构：
- **前端**：React 19 + Vite + Tailwind CSS，Apple 风格 UI
- **后端**：Python FastAPI + LangChain
- **通信**：SSE 流式传输 + JSON Lines 结构化输出
- **配置**：TOML 文件存储（无数据库）

## 开发命令

### 后端
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 前端
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # 生产构建
npm run lint     # ESLint 检查
```

## 架构详解

### 后端文件

#### `main.py` (367 行)
FastAPI 应用，包含以下端点：

| 端点 | 功能 |
|------|------|
| `GET/POST /api/config` | TOML 配置读写 |
| `POST /api/mr/diff` | 从 GitLab 获取 MR 变更 |
| `POST /api/review/structured_stream` | 流式审查，返回 JSON Lines |
| `POST /api/review/stream` | 流式审查，返回 SSE 文本 |
| `POST /api/mr/publish_note` | 发布行级评论到 GitLab |
| `POST /api/review` | 后台任务审查（非阻塞） |

关键实现：
- `execute_review_task()`：后台审查任务
- URL 解析正则：`^(https?://[^/]+)/(.+?)/-/merge_requests/(\d+)`
- GitLab Discussions API 用于行级评论

#### `reviewer.py` (125 行)
LangChain 集成层：

```python
def get_llm() -> BaseChatModel:
    # 工厂函数，根据 provider 返回对应 LLM 实例
    # 支持: openai, anthropic, custom
```

| 函数 | 说明 |
|------|------|
| `load_config()` | 加载 TOML 配置 |
| `save_config()` | 保存 TOML 配置 |
| `get_llm()` | LLM 工厂函数 |
| `review_code_diff()` | 非流式审查 |
| `review_code_diff_stream()` | SSE 流式审查 |
| `review_code_diff_structured()` | JSON Lines 流式审查 |

**注意**：`langchain-google-genai` 已导入但 `get_llm()` 未实现 Gemini 支持。

### 前端文件

#### `App.jsx` (490 行)
主应用组件，两个 Tab：
- **工作台**：MR URL 输入、审查触发、Diff 展示
- **系统设置**：LLM/GitLab/Prompt 配置

关键状态：
- `mrUrl`, `parsedMR`：MR URL 解析
- `mrData`：GitLab 返回的 Diff 数据
- `aiComments`：AI 生成的评论数组
- `statusMessage`：流式状态更新

导航功能：`scrollToNextSuggestion()`, `scrollToPrevSuggestion()`

#### `DiffViewer.jsx` (202 行)
并排 Diff 查看器：
- 使用 `parse-diff` 解析 unified diff
- `CommentBox` 组件：可编辑评论框，支持应用/删除
- 行级评论对齐逻辑

### 配置系统

**文件**：`backend/config.toml`（已 gitignore）

**Schema**：
```toml
[llm_config]
provider = "openai"      # openai | anthropic | custom
base_url = "..."         # API 基础 URL
model_name = "gpt-4o"    # 模型名称
api_key = "..."

[gitlab]
url = "https://gitlab.example.com"
private_token = "..."

[rules]
default_prompt = """..."""

# 以下为旧版格式，逐步废弃
[credentials.*]
[active_settings]
```

### 数据流

```
1. 用户输入 MR URL
2. Frontend: POST /api/mr/diff → 获取 diff_refs 和 changes
3. Frontend: EventSource → /api/review/structured_stream
4. Backend: 调用 GitLab API 获取变更
5. Backend: 构造 Prompt → LLM 流式调用
6. LLM 返回 JSON Lines: {"new_path": "...", "new_line": N, "comment": "..."}
7. Frontend: 解析 JSON，对齐到 Diff 行
8. 用户点击应用 → POST /api/mr/publish_note → GitLab Discussions API
```

### GitLab API 集成

**认证**：`PRIVATE-TOKEN` Header

**端点**：
- `GET /api/v4/projects/:id/merge_requests/:iid` - 获取 MR 元信息
- `GET /api/v4/projects/:id/merge_requests/:iid/changes` - 获取变更
- `POST /api/v4/projects/:id/merge_requests/:iid/discussions` - 发布行级评论

**行级评论 Position 对象**：
```json
{
  "base_sha": "...",
  "head_sha": "...",
  "start_sha": "...",
  "position_type": "text",
  "new_path": "...",
  "new_line": 123
}
```

## 关键注意事项

1. **敏感文件**：`backend/config.toml` 包含真实凭证，禁止提交
2. **硬编码 URL**：前端 API 基础地址硬编码为 `http://localhost:8000`
3. **中文 UI**：界面和 Prompt 主要为中文
4. **LLM 扩展**：新增 Provider 需同时修改 `reviewer.py:get_llm()` 和前端设置 UI
5. **JSON Lines 格式**：`structured_stream` 端点要求 LLM 输出严格 JSON 格式

## 扩展开发指南

### 新增 LLM Provider

1. 在 `requirements.txt` 添加依赖
2. 在 `reviewer.py` 导入对应的 LangChain 集成
3. 修改 `get_llm()` 函数添加分支
4. 更新前端 `App.jsx` 设置页面的 Provider 选项

### 修改审查 Prompt

Prompt 位于 `config.rules.default_prompt`，可通过：
1. 前端「系统设置」页面编辑
2. 直接修改 `config.toml`

### 调整流式输出格式

修改 `reviewer.py:review_code_diff_structured()` 中的额外指令：
```python
additional_instructions = """
请以 JSON Lines 格式输出，每行一个 JSON 对象...
"""
```

## 测试

暂无自动化测试。手动测试流程：
1. 启动后端服务
2. 启动前端服务
3. 配置 GitLab Token 和 LLM API Key
4. 输入真实 MR URL 进行审查
