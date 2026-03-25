from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
import gitlab
from reviewer import load_config, save_config, review_code_diff

app = FastAPI(title="LLM Code Review Agent", version="1.0.0")

class ReviewRequest(BaseModel):
    project_id: str | int
    mr_iid: int

class ConfigUpdateRequest(BaseModel):
    # 此处为简化版的接收全量配置，后续可切分成独立小模块
    config_data: dict

def get_gitlab_client():
    config = load_config()
    gl_config = config.get("gitlab", {})
    gl_url = gl_config.get("url", "")
    gl_token = gl_config.get("private_token", "")
    if not gl_url or not gl_token or gl_token == "CHANGEME":
        raise ValueError("GitLab 配置未设置或使用默认值")
    
    return gitlab.Gitlab(url=gl_url, private_token=gl_token)

def execute_review_task(project_id: str | int, mr_iid: int):
    """后台执行实际审核任务，完成后发送评论到对应的 MR"""
    try:
        gl = get_gitlab_client()
        project = gl.projects.get(project_id)
        mr = project.mergerequests.get(mr_iid)
        
        # 提取当前 MR 的 changes/diffs
        changes = mr.changes()
        diff_texts = []
        for change in changes.get("changes", []):
            new_path = change.get("new_path")
            diff = change.get("diff")
            # 简易组装：跳过无需审查的比如缩略图或者非常大无意义的文件
            diff_texts.append(f"文件路径: {new_path}\n变更内容:\n{diff}")
            
        full_diff_text = "\n---\n".join(diff_texts)
        
        # 为了极简，如果超长应当在此进行分片(Chunking)，这里仅作简单拼接
        # 调用核心审查模块
        review_report = review_code_diff(full_diff_text)
        
        # 发表评论
        mr.notes.create({"body": f"### 🤖 AI 代码审查报告 \n\n{review_report}"})
        print(f"✅ MR {mr_iid} 审查执行成功")
        
    except Exception as e:
        print(f"❌ 审查任务执行失败: {str(e)}")

@app.get("/")
def read_root():
    return {"message": "Welcome to LLM Code Review Agent API"}

@app.get("/api/config")
def get_current_config():
    """获取系统当前配置"""
    try:
        return load_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/config")
def update_current_config(req: ConfigUpdateRequest):
    """全量更新系统 TOML 配置"""
    try:
        save_config(req.config_data)
        return {"message": "配置更新成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/review")
def trigger_review(req: ReviewRequest, background_tasks: BackgroundTasks):
    """手动触发代码审查（非阻塞）"""
    try:
        # 直接交给 FastAPI 自持的后台任务（实现同步响应，异步执行的效果）
        background_tasks.add_task(execute_review_task, req.project_id, req.mr_iid)
        return {"message": "审查任务已加入队列正在后台执行", "project_id": req.project_id, "mr_iid": req.mr_iid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
