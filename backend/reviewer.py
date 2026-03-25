import os
import toml
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage

CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.toml")

def load_config() -> dict:
    """载入 TOML 配置"""
    if not os.path.exists(CONFIG_PATH):
        raise FileNotFoundError(f"配置文件缺失: {CONFIG_PATH}")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return toml.load(f)

def save_config(config_data: dict):
    """保存配置到 TOML"""
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        toml.dump(config_data, f)

def get_llm():
    """工厂模式：根据配置返回对应的 LangChain LLM 实例"""
    config = load_config()
    provider = config.get("active_settings", {}).get("provider", "openai")
    model_name = config.get("active_settings", {}).get("model_name")
    
    if provider == "openai":
        creds = config.get("credentials", {}).get("openai", {})
        return ChatOpenAI(
            api_key=creds.get("api_key", ""),
            base_url=creds.get("base_url") if creds.get("base_url") else None,
            model=model_name
        )
    elif provider == "claude":
        creds = config.get("credentials", {}).get("claude", {})
        return ChatAnthropic(
            anthropic_api_key=creds.get("api_key", ""),
            model=model_name
        )
    elif provider == "gemini":
        creds = config.get("credentials", {}).get("gemini", {})
        return ChatGoogleGenerativeAI(
            google_api_key=creds.get("api_key", ""),
            model=model_name
        )
    else:
        raise ValueError(f"未知的 LLM 提供商: {provider}")

def review_code_diff(diff_content: str) -> str:
    """使用大语言模型审核代码的差异"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])
    
    chain = prompt | llm
    
    # 返回执行结果（纯文本）
    response = chain.invoke({"diff_content": diff_content})
    return response.content
