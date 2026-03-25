# AI Code Reviewer

## 简介
这是一个独立可控的代码审查智能体系统。采用前后端分离的极简架构，摆脱了对特定本地客户端（如 Claude Code）的强绑定。系统支持多语言大模型架构（OpenAI、Anthropic Claude、Google Gemini 等），支持按需动态扩展代码规则，并通过可视化的方式直接与您的 GitLab 进行自动审评交互。

本项目分为两部分：
- **Backend (Python / FastAPI / LangChain)**:  作为核心 AI 引擎调度、模型工厂与 GitLab API 交互。
- **Frontend (React / Tailwind CSS)**: 提供带有 Apple 设计语言（玻璃级面板拟物美学）可视化的评审面板与设置管理台。

---

## 快速开始

### 1. 后端服务 (Backend)

进入 `backend` 目录，安装依赖并启动服务：

```bash
cd backend
# 推荐使用虚拟环境
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Mac/Linux:
# source venv/bin/activate

pip install -r requirements.txt

# 启动 FastAPI 服务 (默认运行在 8000 端口)
uvicorn main:app --reload --port 8000
```
*(注意：请在运行项目前，访问网页管理面板或直接在 `backend/config.toml` 中配置您的 GitLab Token 和大模型 API Key。)*

### 2. 前端服务 (Frontend)

进入 `frontend` 目录，启动 React 本地开发服务器：

```bash
cd frontend
npm install
npm run dev
```

成功启动后，您的浏览器会自动或提示打开 `http://localhost:5173`。

---

## 核心功能与架构特性

- **多模型无缝切换**：采用 LangChain 提供的 Factory 模式，在前端直接配置模型供应商（OpenAI, Claude, Gemini）及对应的 API Key 即可实时生效。
- **纯文本极简配置**：不依赖 SQLite / PostgreSQL 等重型关系库，所有用户与系统状态保存在后端的 `config.toml` 中，保证冷启动的极轻便。
- **异步后台执行调度**：利用 FastAPI 的 BackgroundTasks 进行无阻塞处理，一键点击审查，即可在后台与大模型及 GitLab 拉取耗时的网络通信。
- **高自由度的动态 Prompt**：不再硬编码安全规则，您可以在 Web 面板自主编辑审查要求的 Prompt 参数体系（例如专注于 SQL 注入，或代码拼写错误等单独任务）。
