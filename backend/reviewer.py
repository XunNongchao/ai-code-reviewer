"""
LLM 适配层

只支持两种主流大模型调用协议：
- openai: OpenAI 兼容协议（适用于 OpenAI、智谱、通义千问、DeepSeek、各类中转站等）
- anthropic: Anthropic 协议（适用于 Claude 系列）
"""
import logging
from langchain_openai import ChatOpenAI
from langchain_anthropic import ChatAnthropic
from langchain_core.prompts import ChatPromptTemplate

from database import get_db, init_db, ConfigRepository, LLMProviderRepository

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger("reviewer")

# 初始化数据库（首次导入时执行）
init_db()


def load_config() -> dict:
    """从 SQLite 数据库加载配置"""
    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    settings = config_repo.get_settings()
    if not settings:
        raise RuntimeError("数据库配置未初始化")

    active_provider_name = settings.get('active_provider', 'openai')
    provider = provider_repo.find_by_name(active_provider_name)

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

    logger.debug("配置加载完成: provider=%s, model=%s", active_provider_name, config["llm_config"]["model_name"])
    return config


def save_config(config_data: dict):
    """保存配置到 SQLite 数据库"""
    db = get_db()
    config_repo = ConfigRepository(db)
    provider_repo = LLMProviderRepository(db)

    llm_config = config_data.get('llm_config', {})
    if llm_config:
        provider_name = llm_config.get('provider')
        if provider_name:
            provider_repo.upsert(
                name=provider_name,
                base_url=llm_config.get('base_url'),
                api_key=llm_config.get('api_key')
            )
            config_repo.update_settings(
                active_provider=provider_name,
                active_model=llm_config.get('model_name')
            )

    gitlab_config = config_data.get('gitlab', {})
    if gitlab_config:
        config_repo.update_settings(
            gitlab_url=gitlab_config.get('url'),
            gitlab_token=gitlab_config.get('private_token')
        )

    rules_config = config_data.get('rules', {})
    if rules_config:
        config_repo.update_settings(
            default_prompt=rules_config.get('default_prompt')
        )

    logger.info("配置已保存: provider=%s, model=%s", llm_config.get('provider'), llm_config.get('model_name'))


def get_llm():
    """
    根据配置创建 LLM 实例。

    只支持两种协议：
    - openai: 使用 ChatOpenAI，适用于所有兼容 OpenAI API 的服务
    - anthropic: 使用 ChatAnthropic，适用于 Anthropic Claude 系列
    """
    config = load_config()
    active = config.get("llm_config", {})

    provider = active.get("provider", "openai")
    base_url = active.get("base_url") or None
    api_key = active.get("api_key") or ""
    model_name = active.get("model_name", "")

    logger.info("初始化 LLM: protocol=%s, model=%s, base_url=%s", provider, model_name, base_url or "(默认)")

    if provider == "openai":
        return ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=model_name,
        )
    elif provider == "anthropic":
        kwargs = {
            "anthropic_api_key": api_key,
            "model": model_name,
            "timeout": 60.0,
        }
        if base_url:
            kwargs["anthropic_api_url"] = base_url
        return ChatAnthropic(**kwargs)
    else:
        raise ValueError(
            f"不受支持的协议: '{provider}'。"
            f"当前只支持 'openai'（兼容所有 OpenAI 格式的服务）和 'anthropic'。"
        )


def review_code_diff(diff_content: str) -> str:
    """使用大语言模型审核代码差异（非流式）"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")

    logger.info("开始非流式审查, diff 长度=%d 字符", len(diff_content))

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])

    chain = prompt | llm
    response = chain.invoke({"diff_content": diff_content})

    logger.info("非流式审查完成, 响应长度=%d 字符", len(response.content))
    return response.content


def review_code_diff_stream(diff_content: str):
    """使用大语言模型审核代码差异（流式输出生成器）"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")

    logger.info("开始流式审查, diff 长度=%d 字符", len(diff_content))

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])

    chain = prompt | llm
    chunk_count = 0
    for chunk in chain.stream({"diff_content": diff_content}):
        chunk_count += 1
        yield chunk.content

    logger.info("流式审查完成, 共 %d 个 chunk", chunk_count)


def review_code_diff_structured(diff_content: str):
    """使用大语言模型审核代码差异（流式输出 JSON Lines）"""
    config = load_config()
    llm = get_llm()
    system_rules = config.get("rules", {}).get("default_prompt", "你是一个代码审查专家。")

    json_instruction = (
        "\n请你逐条指出代码中的问题，并必须以 JSON Lines 的格式输出。每一行必须是一个纯净且规范的 JSON 对象，包含如下格式：\n"
        '{{"new_path": "文件路径", "new_line": 具体发生问题的行号(必须是整数), "comment": "问题描述与修改建议"}}\n'
        "请注意，遇到多行代码建议合并处理，指定为其中某一行号即可。不要输出任何其他文本内容（绝对不要附带 ```json 等 Markdown 标签）。"
    )

    logger.info("开始结构化流式审查, diff 长度=%d 字符", len(diff_content))

    prompt = ChatPromptTemplate.from_messages([
        ("system", system_rules + json_instruction),
        ("human", "以下是代码的 diff 记录（包含变更路径和具体增删内容）：\n\n{diff_content}")
    ])

    chain = prompt | llm
    chunk_count = 0
    for chunk in chain.stream({"diff_content": diff_content}):
        chunk_count += 1
        yield chunk.content

    logger.info("结构化流式审查完成, 共 %d 个 chunk", chunk_count)
