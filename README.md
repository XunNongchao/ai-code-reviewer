# AI Code Reviewer

一款独立可控的 GitLab MR 代码审查智能体。前后端分离架构，支持 OpenAI 兼容协议和 Anthropic 协议，提供可视化的 Diff 审查面板与行级评论回写。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + Vite + Tailwind CSS |
| 后端 | Python 3.10+ / FastAPI / LangChain |
| 持久化 | SQLite（WAL 模式，自动初始化） |
| 通信 | SSE (Server-Sent Events) + JSON Lines |

## 支持的 LLM 协议

| 协议 | 说明 |
|------|------|
| `openai` | OpenAI 兼容协议 — 适用于 OpenAI、智谱 GLM、通义千问、DeepSeek、Moonshot、各类中转站 |
| `anthropic` | Anthropic 协议 — 适用于 Claude 系列 |

> 只要你的大模型服务兼容 OpenAI 的 `/v1/chat/completions` 接口，选 `openai` 协议填入对应 base_url 即可。

---

## 快速开始

### 前置条件

- Python 3.10+
- Node.js 18+
- 一个可用的 LLM API Key
- 一个 GitLab Private Token（用于读取 MR 和发布评论）

### 1. 启动后端

```bash
cd backend

# 创建虚拟环境
python -m venv .venv

# 激活（Windows）
.\.venv\Scripts\activate
# 激活（Mac/Linux）
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 启动服务（首次启动会自动创建 data/code_reviewer.db）
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

启动后会在 `backend/data/` 目录下自动生成 `code_reviewer.db` 数据库文件，无需手动建表。

### 2. 启动前端

```bash
cd frontend
npm install
npm run dev    # 开发服务器 http://localhost:5173
```

### 3. 配置（首次使用必做）

打开浏览器访问 `http://localhost:5173`，点击顶部「系统设置」Tab：

#### 3.1 配置大模型

1. **调用协议**：选择 `openai` 或 `anthropic`
2. **接口地址 (Base URL)**：
   - OpenAI 官方：`https://api.openai.com/v1`
   - 智谱 GLM：`https://open.bigmodel.cn/api/paas/v4`
   - 通义千问：`https://dashscope.aliyuncs.com/compatible-mode/v1`
   - DeepSeek：`https://api.deepseek.com`
   - 自建中转站：填你的中转地址
   - Anthropic：可留空使用默认地址
3. **模型名称**：如 `gpt-4o-mini`、`glm-4`、`qwen-plus`、`deepseek-chat`、`claude-sonnet-4-20250514`
4. **API Key**：填入对应服务的密钥

#### 3.2 配置 GitLab

1. **GitLab 实例地址**：如 `https://gitlab.example.com`
2. **Private Token**：
   - 登录 GitLab → Settings → Access Tokens
   - 创建 Token，勾选 `api` 权限（如果只需读取可勾选 `read_api`，但发布评论需要 `api`）
   - 复制生成的 Token 填入

#### 3.3 审查规则（可选）

自定义系统 Prompt，指导 AI 关注哪些方面（安全、性能、代码风格等）。

配置完成后点击「保存全局配置」。

---

## 使用方式

### 单个 MR 审查

1. 复制 GitLab MR 的 URL，如：`https://gitlab.example.com/group/project/-/merge_requests/123`
2. 粘贴到工作台输入框
3. 点击「一键开始审查代码」
4. 等待 AI 分析完成，在 Diff 视图中查看逐行建议
5. 对满意的建议点击「应用此建议」发布到 GitLab

### 批量 MR 审查

1. 粘贴多个 MR URL（换行、空格或逗号分隔）
2. 在列表中可删除不需要的 MR
3. 点击「开始批量审查」
4. 逐个完成后可切换查看各 MR 的审查结果

### 历史记录

- 所有审查会话自动保存
- 可查看历史评论和发布状态
- 支持多选删除或全部清空

---

## 项目结构

```
ai-code-reviewer/
├── backend/
│   ├── main.py                  # 应用入口
│   ├── routers/                 # API 路由层
│   │   ├── config.py            # 配置管理
│   │   ├── review.py            # 审查相关
│   │   ├── comments.py          # 评论管理
│   │   └── history.py           # 历史记录
│   ├── services/                # 业务服务层
│   │   ├── gitlab_service.py    # GitLab API 客户端
│   │   └── review_service.py    # 审查编排
│   ├── reviewer.py              # LLM 适配层
│   ├── database.py              # SQLite 数据层
│   ├── models.py                # Pydantic 模型
│   ├── schema.sql               # 数据库表结构
│   ├── migration.py             # TOML→SQLite 迁移工具
│   ├── config.example.toml      # 配置模板
│   ├── data/                    # 数据库文件目录（自动生成）
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # 壳组件
│   │   ├── api/                 # API 请求层
│   │   ├── hooks/               # 业务逻辑 hooks
│   │   ├── pages/               # 页面组件
│   │   └── components/          # 通用组件
│   ├── public/favicon.svg       # Logo
│   ├── package.json
│   └── vite.config.js
├── AGENTS.md                    # 开发指南
├── technical-analysis.md        # 架构分析文档
└── README.md
```

## API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/config` | GET/POST | 配置读取与保存 |
| `/api/mr/diff` | POST | 获取 MR Diff 数据 |
| `/api/review/structured_stream` | POST | 流式结构化审查 |
| `/api/mr/publish_note` | POST | 发布行级评论到 GitLab |
| `/api/session/comments` | POST | 保存会话评论 |
| `/api/comments/{id}/publish` | POST | 通过 ID 发布评论 |
| `/api/history` | GET/DELETE | 历史记录列表 / 全部清空 |
| `/api/history/{uuid}` | GET | 历史详情 |
| `/api/history/delete` | POST | 批量删除选中记录 |

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
4. LLM 流式返回 JSON Lines → 前端实时解析并渲染到 Diff 行
5. 用户确认评论 → `/api/mr/publish_note` 发布到 GitLab 行内讨论

## 安全提示

- 数据库文件 `backend/data/code_reviewer.db` 包含 API Key 和 GitLab Token，**切勿提交到版本控制**
- 建议使用 GitLab 的 scoped token（仅 `api` 权限）
- 当前无认证层，建议仅在内网或本地使用
- 生产部署时建议添加认证中间件

## License

MIT
