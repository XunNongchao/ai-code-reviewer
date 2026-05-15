# CLAUDE.md

本文件供 Claude Code / Codex 等 AI 编码助手读取，提供项目上下文。

## 项目定位

AI Code Reviewer — 一个面向私有化 GitLab 的 MR 代码审查工具。核心链路：拉取 MR diff → LLM 结构化审查 → 前端行级展示 → 一键回评到 GitLab。

## 技术栈速查

- 前端：React 19 + Vite 5 + Tailwind CSS 3 + axios + parse-diff + lucide-react
- 后端：Python 3.10+ / FastAPI / LangChain / SQLite / httpx
- LLM：仅 OpenAI 兼容协议 (`ChatOpenAI`) 和 Anthropic 协议 (`ChatAnthropic`)
- 通信：SSE + JSON Lines

## 目录结构要点

```
backend/
  main.py           → 入口，只做初始化和路由注册
  routers/          → 4 个路由模块（config, review, comments, history）
  services/         → gitlab_service.py（API 客户端）, review_service.py（业务编排）
  reviewer.py       → LLM 工厂 + 审查函数
  database.py       → SQLite Repository 层
  schema.sql        → DDL（启动时自动执行 CREATE IF NOT EXISTS）

frontend/src/
  App.jsx           → 壳组件（Tab 导航，hidden 切换保活）
  pages/            → ReviewPage, HistoryPage, SettingsPage
  hooks/            → useMrUrlParser, useReviewStream（支持 AbortSignal）
  api/              → client.js（axios 实例）, index.js（API 函数）
  components/       → DiffViewer, Logo
```

## 开发约定

1. **后端分层**：路由层只做参数校验和响应格式化，业务逻辑放 services/，LLM 调用放 reviewer.py
2. **前端分层**：页面组件管状态，hooks 封装逻辑，api/ 统一请求，components/ 纯 UI
3. **LLM Prompt**：在 `ChatPromptTemplate` 中使用 `{variable}` 作为变量，JSON 示例中的花括号必须用 `{{` `}}` 转义
4. **配置管理**：全部走 SQLite，通过前端设置页面操作，不再使用 TOML 文件
5. **日志**：后端各层使用 `logging.getLogger(__name__)` 记录关键行为
6. **前端状态保活**：Tab 切换使用 CSS `hidden` class，不卸载组件

## 常用开发命令

```bash
# 后端
cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 前端
cd frontend && npm run dev

# 构建
cd frontend && npm run build
```

## 修改指南

| 需求 | 改动位置 |
|------|----------|
| 新增 API 端点 | `routers/` 下对应文件，复杂逻辑抽到 `services/` |
| 新增 LLM 协议 | `reviewer.py:get_llm()` + `requirements.txt` + `SettingsPage.jsx` |
| 修改审查 Prompt | 前端设置页面，或 `reviewer.py` 中的 `json_instruction` |
| 修改数据库表 | `schema.sql` + `database.py` 对应 Repository |
| 新增前端页面 | `pages/` 下新建组件，在 `App.jsx` 中注册 |

## 注意事项

- `backend/data/code_reviewer.db` 含敏感凭证，已 gitignore
- 前端 API 地址动态取 `window.location.hostname:8000`
- 审查流程支持 AbortController 中止
- GitLab API 封装在 `GitLabClient` 类中，统一认证和超时
