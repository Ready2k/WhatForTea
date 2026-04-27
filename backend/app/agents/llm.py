"""
Shared LLM factory for all agents.

Uses Claude Haiku for all agent routing, intent classification, and
conversational responses. Sonnet stays reserved for heavy tasks (ingest,
normalisation, nutrition) via the existing bedrock.py service.
"""
from functools import lru_cache

import boto3
from langchain_aws import ChatBedrock

from app.config import settings


@lru_cache(maxsize=1)
def get_haiku():
    """
    Cached model for agent use.
    Returns ChatBedrock by default, or ChatOllama if configured.
    Model ID sourced from agent_settings.yaml / BEDROCK_TEXT_MODEL_ID env var.
    """
    if settings.llm_provider == "ollama":
        try:
            from langchain_ollama import ChatOllama
            return ChatOllama(
                model=settings.ollama_model,
                base_url=settings.ollama_base_url,
                temperature=0.1,
            )
        except ImportError:
            pass

    from app.services.bedrock import _model_id
    client = boto3.client(
        service_name="bedrock-runtime",
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        region_name=settings.aws_region,
        endpoint_url=settings.aws_endpoint_url or None,
    )
    return ChatBedrock(client=client, model_id=_model_id(vision=False))
