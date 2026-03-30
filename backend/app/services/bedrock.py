"""
AWS Bedrock client wrapper.

Reads model config from backend/agent_config/agent_settings.yaml and
prompt templates from the .md files in the same directory.
All prompt text lives in those files — nothing hardcoded here.
"""
import json
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
import yaml
from jinja2 import Template

logger = logging.getLogger(__name__)

_AGENT_CONFIG_DIR = Path(__file__).parent.parent.parent / "agent_config"


@lru_cache(maxsize=1)
def _load_settings() -> dict:
    path = _AGENT_CONFIG_DIR / "agent_settings.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


def _load_prompt(filename: str) -> str:
    path = _AGENT_CONFIG_DIR / filename
    with open(path) as f:
        return f.read()


@lru_cache(maxsize=1)
def _get_client():
    from app.config import settings
    return boto3.client(
        "bedrock-runtime",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )


async def call_normaliser_llm(raw_name: str, candidate: str) -> dict[str, Any]:
    """
    Ask the LLM whether raw_name matches the candidate canonical ingredient.
    Returns {"match": bool, "confidence": float, "reasoning": str}
    """
    cfg = _load_settings()
    template_src = _load_prompt("normaliser_prompt.md")

    # Extract only the content after the last ## System header
    system_section = ""
    user_section = ""
    for line in template_src.splitlines():
        if line.startswith("## System"):
            system_section = ""
            continue
        if line.startswith("## Task"):
            user_section = ""
            continue
        system_section += line + "\n"

    # Render template variables
    rendered = Template(template_src).render(raw_name=raw_name, candidate=candidate)

    # Extract system + user parts from rendered prompt
    parts = rendered.split("## Task", 1)
    system_prompt = parts[0].replace("## System", "").strip()
    user_prompt = ("## Task" + parts[1]).strip() if len(parts) > 1 else rendered.strip()

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 256,
        "temperature": cfg.get("temperature", 0.1),
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_prompt}],
    }

    try:
        client = _get_client()
        response = client.invoke_model(
            modelId=cfg["model_id"],
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        result_body = json.loads(response["body"].read())
        text = result_body["content"][0]["text"].strip()

        # Strip markdown fences if present
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        parsed = json.loads(text)
        logger.info(
            "normaliser LLM call",
            extra={
                "raw_name": raw_name,
                "candidate": candidate,
                "match": parsed.get("match"),
                "confidence": parsed.get("confidence"),
            },
        )
        return parsed
    except Exception as exc:
        logger.warning("normaliser LLM call failed", extra={"error": str(exc)})
        return {"match": False, "confidence": 0.0, "reasoning": f"LLM error: {exc}"}
