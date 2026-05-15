# AGENTS.md

AI Code Reviewer 开发指南。

## 项目概述

GitLab MR 代码审查智能体，前后端分离架构：
- **前端**：React 19 + Vite + Tailwind CSS，Apple 风格 UI
- **后端**：Python FastAPI + LangChain
- **持久化**：SQLite（WAL 模式，启动时自动初始化）
- **通信**：SSE 流式传输 + JSON Lines 结构化输出
- **LLM 协议**：仅支持 OpenAI 兼容协议 和 Anthropic 协议

## 开发命令

### 后端
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate  # Windows
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 前端
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 (vite.config.js 已配置 host: '0.0.0.0')
npm run build    # 生产构建
npm run lint     # ESLint 检查
```

## 项目结构

```text
backend/
├─ main.py                  # 应用入口：初始化、中间件、路由注册
├─ routers/
│  ├─ config.py             # GET/POST /api/config
│  ├─ review.py             # POST /api/mr/diff, /api/review/structured_stream
│  ├─ comments.py           # POST /api/mr/publish_note, /api/session/comments, /api/comments/{id}/publish
│  └─ history.py            # GET/DELETE /api/history, POST /api/history/delete
├─ services/
│  ├─ gitlab_service.py     # GitLab REST API 客户端封装
│  └─ review_service.py     # 审查业务编排
├─ reviewer.py              # LLM 适配层（get_llm, 审查函数）
├─ database.py              # SQLite 连接管理 + Repository 层
├─ models.py                # Pydantic 数据模型
├─ schema.sql               # 数据库表结构（启动时自动执行）
├─ migration.py             # TOML→SQLite 迁移工具（历史遗留）
└─ requirements.txt

frontend/src/
├─ main.jsx                 # 入口
├─ App.jsx                  # 壳组件：Tab 导航 + 消息提示
├─ App.css                  # 自定义动画
├─ index.css                # Tailwind 基础 + utility
├─ api/
│  ├─ client.js             # axios 实例 + API_BASE
│  └─ index.js              # 按领域分组的 API 函数
├─ hooks/
│  ├─ useMrUrlParser.js     # MR URL 解析
│  └─ useReviewStream.js    # SSE 流式审查（支持 AbortSignal）
├─ components/
│  ├─ DiffViewer.jsx        # Diff 并排展示 + 评论卡片
│  └─ Logo.jsx              # SVG Logo 组件
└─ pages/
   ├─ ReviewPage.jsx        # 审查工作台（单个/批量/全屏聚焦）
   ├─ HistoryPage.jsx       # 历史记录（多选删除/全部清空）
   └─ SettingsPage.jsx      # 系统设置
```

## 架构分层

### 后端

| 层 | 职责 | 文件 |
|---|---|---|
| 路由层 | 请求入口、参数校验、响应格式 | `routers/*.py` |
| 服务层 | 业务编排、跨模块协调 | `services/*.py` |
| LLM 层 | 模型调用、Prompt 管理 | `reviewer.py` |
| 数据层 | SQLite CRUD、Repository 模式 | `database.py` |

### 前端

| 层 | 职责 | 文件 |
|---|---|---|
| 页面 | 页面级状态管理与布局 | `pages/*.jsx` |
| 组件 | 可复用 UI 组件 | `components/*.jsx` |
| Hooks | 业务逻辑封装 | `hooks/*.js` |
| API | 后端请求统一管理 | `api/*.js` |

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET/POST | 配置读取与保存 |
| `/api/mr/diff` | POST | 获取 MR Diff 数据 |
| `/api/review/structured_stream` | POST | 流式结构化审查（SSE + JSON Lines） |
| `/api/mr/publish_note` | POST | 发布行级评论到 GitLab |
| `/api/session/comments` | POST | 保存会话评论 |
| `/api/comments/{id}/publish` | POST | 通过 ID 发布评论 |
| `/api/history` | GET | 历史记录列表 |
| `/api/history` | DELETE | 清空所有历史 |
| `/api/history/{uuid}` | GET | 历史详情 |
| `/api/history/delete` | POST | 批量删除选中记录 |
| `/api/sessions/{uuid}/comments` | GET | 获取会话评论 |

## 数据流

```
1. 用户输入 MR URL
2. ReviewPage → useReviewStream.executeReview()
3. executeReview → fetch /api/mr/diff → 获取 diff_refs 和 changes
4. executeReview → fetch /api/review/structured_stream → SSE 流
5. 后端 routers/review.py → services/review_service.py → reviewer.py → LLM
6. LLM 返回 JSON Lines: {"new_path": "...", "new_line": N, "comment": "..."}
7. 前端解析 JSON，通过 callbacks 更新 UI
8. 用户点击应用 → /api/mr/publish_note → GitLab Discussions API
```

## LLM 适配

只支持两种协议：

| 协议 | 实现 | 适用场景 |
|------|------|------|
| `openai` | `ChatOpenAI` | OpenAI、智谱、通义、DeepSeek、Moonshot、各类中转站 |
| `anthropic` | `ChatAnthropic` | Claude 系列 |

`get_llm()` 工厂函数根据 `provider` 字段选择对应实现。

### 新增 LLM 协议

1. 在 `requirements.txt` 添加 LangChain 集成包
2. 在 `reviewer.py:get_llm()` 添加 elif 分支
3. 更新前端 `SettingsPage.jsx` 的 Provider 下拉选项

## GitLab API 集成

封装在 `services/gitlab_service.py` 的 `GitLabClient` 类中：

| 方法 | 说明 |
|------|------|
| `parse_mr_url(url)` | 静态方法，解析 MR URL |
| `get_merge_request()` | 获取 MR 元信息 |
| `get_merge_request_changes()` | 获取 MR 变更（diff） |
| `create_mr_note()` | 创建普通 note |
| `create_discussion()` | 创建行内 discussion 评论 |

**行级评论 Position 对象**：
```json
{
  "position_type": "text",
  "base_sha": "...",
  "head_sha": "...",
  "start_sha": "...",
  "new_path": "...",
  "new_line": 123
}
```

## 配置系统

配置存储在 SQLite 数据库中（`backend/data/code_reviewer.db`），通过前端设置页面管理。

关键表：
- `config_settings`：单例配置行（active_provider, active_model, gitlab_url, gitlab_token, default_prompt）
- `llm_providers`：Provider 连接信息（name, base_url, api_key）

## 关键注意事项

1. **敏感数据**：`backend/data/code_reviewer.db` 包含 API Key 和 GitLab Token，已 gitignore
2. **API 地址**：前端动态获取 `window.location.hostname:8000`，支持局域网
3. **中文 UI**：界面和 Prompt 主要为中文
4. **JSON Lines 格式**：`structured_stream` 端点要求 LLM 输出严格 JSON，Prompt 中用 `{{}}` 转义花括号
5. **AbortSignal**：前端审查流程支持中止，通过 AbortController 取消 fetch 请求
6. **Tab 切换保活**：页面组件使用 CSS hidden 而非条件渲染，切换 tab 不丢失状态

## 测试

暂无自动化测试。手动测试流程：
1. 启动后端：`uvicorn main:app --reload --host 0.0.0.0 --port 8000`
2. 启动前端：`npm run dev`
3. 在「系统设置」配置 LLM API Key 和 GitLab Token
4. 输入真实 MR URL 进行审查
