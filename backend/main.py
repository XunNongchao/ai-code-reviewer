"""
AI Code Reviewer - FastAPI 应用入口

职责：应用初始化、中间件配置、路由注册。
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from routers import config, review, comments, history

# 初始化数据库
init_db()

app = FastAPI(title="LLM Code Review Agent", version="2.0.0")

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(config.router)
app.include_router(review.router)
app.include_router(comments.router)
app.include_router(history.router)


@app.get("/")
def read_root():
    return {"message": "Welcome to LLM Code Review Agent API"}
