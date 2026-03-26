import os
import toml
import logging
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import SystemMessage, HumanMessage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CodeReviewer")

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
