import os
import logging
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage

# 导入数据库层
from database import get_db, init_db, ConfigRepository, LLMProviderRepository

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CodeReviewer")

# 初始化数据库（首次导入时执行）
init_db()

def load_config() -> dict:
    """从 SQLite 数据库加载配置（保持与原 TOML 格式兼容）"""
    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    settings = config_repo.get_settings()
    if not settings:
        raise RuntimeError("数据库配置未初始化")

    # 获取当前活跃的 provider 信息
    active_provider_name = settings.get('active_provider', 'openai')
    provider = provider_repo.find_by_name(active_provider_name)

    # 构建与原 TOML 格式兼容的配置结构
    config = {
        "llm_config": {
            "provider": active_provider_name,
            "model_name": settings.get('active_model', 'gpt-4o-mini'),
            "base_url": provider.get('base_url') if provider else None,
            "api_key": provider.get('api_key') if provider else None,
        },
        "gitlab": {
            "url": settings.get('gitlab_url', 'https://gitlab.example.com'),
            "private_token": settings.get('gitlab_token'),
        },
        "rules": {
            "default_prompt": settings.get('default_prompt', '你是一个代码审查专家。'),
        }
    }

    return config

def save_config(config_data: dict):
    """保存配置到 SQLite 数据库"""
    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    # 更新 llm_config 相关配置
    llm_config = config_data.get('llm_config', {})
    if llm_config:
        provider_name = llm_config.get('provider')
        if provider_name:
            # 更新或创建 provider
            provider_repo.upsert(
                name=provider_name,
                base_url=llm_config.get('base_url'),
                api_key=llm_config.get('api_key')
            )
            # 更新活跃配置
            config_repo.update_settings(
                active_provider=provider_name,
                active_model=llm_config.get('model_name')
            )

    # 更新 gitlab 配置
    gitlab_config = config_data.get('gitlab', {})
    if gitlab_config:
        config_repo.update_settings(
            gitlab_url=gitlab_config.get('url'),
            gitlab_token=gitlab_config.get('private_token')
        )

    # 更新 rules 配置
    rules_config = config_data.get('rules', {})
    if rules_config:
        config_repo.update_settings(
            default_prompt=rules_config.get('default_prompt')
        )

def get_llm():
    """采用类 Inkos 的单一全局配置方案，彻底脱离多厂商多 Key 的结构包袱。
       配置文件中仅保留全局一个[llm_config]。
    """
    config = load_config()
    
    # 向下游兼容：如果界面新提交了 llm_config 就用它，没有再找老版的 active_settings
    active = config.get("llm_config") or config.get("active_settings", {})
    
    # provider 只有三种：openai, anthropic, custom
    provider = active.get("provider", "custom")
    
    # 彻底扁平化读取，不再从复杂的 credentials 判断
    base_url = active.get("base_url") or ""
    api_key = active.get("api_key") or ""
    model_name = active.get("model_name", "")
    
    if not base_url:
        base_url = None
        
    if provider == "openai":
        return ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model_name
        )
    elif provider == "custom":
        return ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model_name
        )
    elif provider == "anthropic":
        kwargs = {
            "anthropic_api_key": api_key,
            "model": model_name,
            "timeout": 60.0
        }
        if base_url:
            kwargs["anthropic_api_url"] = base_url
        return ChatAnthropic(**kwargs)
    else:
        raise ValueError(f"不受支持的 Provider 协议: {provider}。请选择 openai, anthropic 或 custom。")

def review_code_diff(diff_content: str) -> str:
    """使用大语言模型审核代码的差异（非流式）"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])
    
    chain = prompt | llm
    response = chain.invoke({"diff_content": diff_content})
    return response.content

def review_code_diff_stream(diff_content: str):
    """使用大语言模型审核代码的差异（流式输出生成器）"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])
    
    # 将模型转化为流式输出
    chain = prompt | llm
    
    for chunk in chain.stream({"diff_content": diff_content}):
        yield chunk.content

def review_code_diff_structured(diff_content: str):
    """使用大语言模型审核代码的差异（流式输出 JSON Lines）"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")
    
    json_instruction = (
        "\\n请你逐条指出代码中的问题，并必须以 JSON Lines 的格式输出。每一行必须是一个纯净且规范的 JSON 对象，包含如下格式：\\n"
        '{{"new_path": "文件路径", "new_line": 具体发生问题的行号(必须是整数), "comment": "问题描述与修改建议"}}\\n'
        "请注意，遇到多行代码建议合并处理，指定为其中某一行号即可。不要输出任何其他文本内容（绝对不要附带 ```json 等 Markdown 标签）。"
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules + json_instruction),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])
    
    chain = prompt | llm
    
    for chunk in chain.stream({"diff_content": diff_content}):
        yield chunk.content

