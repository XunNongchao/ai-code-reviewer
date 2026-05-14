# AGENTS.md

AI Code Reviewer 开发指南。

## 项目概述

GitLab MR 代码审查智能体，前后端分离架构：
- **前端**：React 19 + Vite + Tailwind CSS，Apple 风格 UI
- **后端**：Python FastAPI + LangChain
- **通信**：SSE 流式传输 + JSON Lines 结构化输出
- **持久化**：SQLite（WAL 模式）

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
npm run dev      # http://localhost:5173
npm run build    # 生产构建
npm run lint     # ESLint 检查
```

## 项目结构

```text
ai-code-reviewer/
├─ backend/
│  ├─ main.py                  # 应用入口：初始化、中间件、路由注册
│  ├─ routers/
│  │  ├─ config.py             # GET/POST /api/config
│  │  ├─ review.py             # POST /api/mr/diff, /api/review/structured_stream
│  │  ├─ comments.py           # POST /api/mr/publish_note, /api/session/comments, /api/comments/{id}/publish
│  │  └─ history.py            # GET /api/history, /api/history/{uuid}, /api/sessions/{uuid}/comments
│  ├─ services/
│  │  ├─ gitlab_service.py     # GitLab REST API 客户端封装
│  │  └─ review_service.py     # 审查业务编排（会话创建、diff 拼接、发布）
│  ├─ reviewer.py              # LLM 适配层（load_config, get_llm, 审查函数）
│  ├─ database.py              # SQLite 连接管理 + Repository 层
│  ├─ models.py                # Pydantic 数据模型
│  ├─ migration.py             # TOML → SQLite 迁移脚本
│  ├─ schema.sql               # 数据库表结构
│  └─ requirements.txt
├─ frontend/
│  ├─ src/
│  │  ├─ main.jsx              # 入口
│  │  ├─ App.jsx               # 壳组件：Tab 导航 + 消息提示
│  │  ├─ App.css               # 自定义动画与滚动条样式
│  │  ├─ index.css             # Tailwind 基础 + 自定义 utility
│  │  ├─ api/
│  │  │  ├─ client.js          # axios 实例 + API_BASE 常量
│  │  │  └─ index.js           # 按领域分组的 API 函数
│  │  ├─ hooks/
│  │  │  ├─ useMrUrlParser.js  # MR URL 解析 hook
│  │  │  └─ useReviewStream.js # SSE 流式审查逻辑
│  │  ├─ components/
│  │  │  └─ DiffViewer.jsx     # Diff 并排展示 + 评论卡片
│  │  └─ pages/
│  │     ├─ ReviewPage.jsx     # 审查工作台（单个/批量）
│  │     ├─ HistoryPage.jsx    # 历史记录
│  │     └─ SettingsPage.jsx   # 系统设置
│  ├─ package.json
│  ├─ vite.config.js
│  └─ tailwind.config.js
└─ technical-analysis.md        # 源码分析文档
```

## 架构分层

### 后端分层

| 层 | 职责 | 文件 |
|---|---|---|
| 路由层 | 请求入口、参数校验、响应格式 | `routers/*.py` |
| 服务层 | 业务编排、跨模块协调 | `services/*.py` |
| LLM 层 | 模型调用、Prompt 管理 | `reviewer.py` |
| 数据层 | SQLite CRUD、Repository 模式 | `database.py` |

### 前端分层

| 层 | 职责 | 文件 |
|---|---|---|
| 页面 | 页面级状态管理与布局 | `pages/*.jsx` |
| 组件 | 可复用 UI 组件 | `components/*.jsx` |
| Hooks | 业务逻辑封装 | `hooks/*.js` |
| API | 后端请求统一管理 | `api/*.js` |

## 数据流

```
1. 用户输入 MR URL
2. ReviewPage → useReviewStream.executeReview()
3. executeReview → reviewApi.getMrDiff() → 获取 diff_refs 和 changes
4. executeReview → reviewApi.getStructuredStreamReader() → SSE 流
5. 后端 routers/review.py → services/review_service.py → reviewer.py → LLM
6. LLM 返回 JSON Lines: {"new_path": "...", "new_line": N, "comment": "..."}
7. 前端解析 JSON，通过 callbacks 更新 UI
8. 用户点击应用 → commentApi.publishNote() → GitLab Discussions API
```

## 关键注意事项

1. **敏感文件**：`backend/config.toml` 包含真实凭证，禁止提交
2. **API 地址**：前端动态获取 `window.location.hostname:8000`，支持局域网
3. **中文 UI**：界面和 Prompt 主要为中文
4. **LLM 协议**：只支持两种 — `openai`（兼容所有 OpenAI 格式服务）和 `anthropic`
5. **JSON Lines 格式**：`structured_stream` 端点要求 LLM 输出严格 JSON 格式

## 扩展开发指南

### 新增 LLM Provider
当前只支持 OpenAI 兼容协议和 Anthropic 协议。如需新增：
1. 在 `requirements.txt` 添加 LangChain 集成包
2. 在 `reviewer.py:get_llm()` 添加新的 elif 分支
3. 更新前端 `SettingsPage.jsx` 的 Provider 选项

### 新增 API 端点
1. 在 `routers/` 下对应文件添加路由
2. 如需业务编排，在 `services/` 下添加函数
3. `main.py` 已自动注册所有 router，无需额外配置

### 修改审查 Prompt
通过前端「系统设置」页面编辑，或直接修改数据库中的 `default_prompt`。

## 测试

暂无自动化测试。手动测试流程：
1. 启动后端：`uvicorn main:app --reload --host 0.0.0.0 --port 8000`
2. 启动前端：`npm run dev`
3. 配置 GitLab Token 和 LLM API Key
4. 输入真实 MR URL 进行审查
