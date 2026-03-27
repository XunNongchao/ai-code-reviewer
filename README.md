# AI Code Reviewer

一款独立可控的 GitLab MR 代码审查智能体，采用前后端分离架构，支持多 LLM 提供商，提供可视化的 Diff 审查面板。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite + Tailwind CSS |
| 后端 | Python 3.10+ / FastAPI / LangChain |
| 配置 | TOML（无数据库依赖） |
| 通信 | SSE (Server-Sent Events) + JSON Lines |

## 支持的 LLM 提供商

| Provider | 说明 |
|----------|------|
| `openai` | OpenAI 官方 API (GPT-4, GPT-4o 等) |
| `anthropic` | Anthropic Claude API |
| `custom` | 任意 OpenAI 兼容 API（代理、中转、私有部署） |

## 快速开始

### 1. 后端服务

```bash
cd backend

# 创建虚拟环境
python -m venv venv

# Windows 激活
.\venv\Scripts\activate
# Mac/Linux 激活
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动服务 (默认端口 8000)
uvicorn main:app --reload --port 8000
```

### 2. 前端服务

```bash
cd frontend
npm install
npm run dev    # 开发服务器 http://localhost:5173
npm run build  # 生产构建
```

### 3. 配置

首次运行时，访问前端「系统设置」页面配置：

1. **LLM 配置**：选择 Provider，填写 API Key 和 Model Name
2. **GitLab 配置**：填写 GitLab URL 和 Private Token
3. **审查规则**：自定义 Prompt（可选）

配置将保存至 `backend/config.toml`（已加入 .gitignore）。

也可以直接复制模板文件：

```bash
cp backend/config.example.toml backend/config.toml
# 编辑 config.toml 填入实际凭证
```

## 核心功能

### 工作台
- 输入 GitLab MR URL，自动解析项目 ID 和 MR IID
- 实时流式审查，SSE 推送 AI 分析进度
- 并排 Diff 视图，AI 评论精准对齐到代码行
- 一键将评论发布到 GitLab MR（使用 Discussions API）

### 系统设置
- LLM Provider 切换（OpenAI / Anthropic / Custom）
- 自定义 base_url（支持代理和私有部署）
- GitLab 连接配置
- 审查 Prompt 自定义

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET/POST | 配置管理 |
| `/api/mr/diff` | POST | 获取 MR Diff 数据 |
| `/api/review/structured_stream` | POST | 流式审查（JSON Lines） |
| `/api/review/stream` | POST | 流式审查（SSE 文本） |
| `/api/mr/publish_note` | POST | 发布行级评论到 GitLab |
| `/api/review` | POST | 后台任务审查（非阻塞） |

## 项目结构

```
ai-code-reviewer/
├── backend/
│   ├── main.py           # FastAPI 应用入口
│   ├── reviewer.py       # LangChain LLM 集成
│   ├── config.toml       # 运行时配置（敏感，已 gitignore）
│   ├── config.example.toml  # 配置模板
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx       # 主应用（工作台 + 设置）
│   │   ├── DiffViewer.jsx # 并排 Diff 查看器
│   │   └── ...
│   ├── package.json
│   └── vite.config.js
├── README.md
└── CLAUDE.md
```

## 数据流

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Frontend  │───▶│   Backend   │───▶│   GitLab    │
│  (React)    │◀───│  (FastAPI)  │◀───│    API      │
└─────────────┘    └──────┬──────┘    └─────────────┘
                          │
                          ▼
                   ┌─────────────┐
                   │  LLM API    │
                   │(OpenAI/etc) │
                   └─────────────┘
```

1. 用户粘贴 MR URL → 前端调用 `/api/mr/diff` 获取变更
2. 前端建立 SSE 连接 → `/api/review/structured_stream`
3. 后端获取 Diff → 构造 Prompt → 调用 LLM
4. LLM 流式返回 JSON Lines → 前端解析并渲染
5. 用户确认评论 → `/api/mr/publish_note` 发布到 GitLab

## 安全提示

- `backend/config.toml` 包含敏感凭证，**切勿提交到版本控制**
- 建议使用 GitLab 的 scoped token（仅 api 权限）
- 生产部署时建议添加认证层

## License

MIT
