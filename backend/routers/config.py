"""配置管理路由"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from reviewer import load_config, save_config

router = APIRouter(prefix="/api", tags=["config"])


class ConfigUpdateRequest(BaseModel):
    config_data: dict


@router.get("/config")
def get_current_config():
    """获取系统当前配置"""
    try:
        return load_config()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/config")
def update_current_config(req: ConfigUpdateRequest):
    """全量更新系统配置"""
    try:
        save_config(req.config_data)
        return {"message": "配置更新成功"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
