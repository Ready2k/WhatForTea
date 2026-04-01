"""
AWS Bedrock client wrapper.

Reads model config from backend/agent_config/agent_settings.yaml and
prompt templates from the .md files in the same directory.
All prompt text lives in those files — nothing hardcoded here.
"""
import base64
import json
import logging
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
        cfg = yaml.safe_load(f)
    # Allow .env BEDROCK_MODEL_ID to override the YAML value
    from app.config import settings
    if settings.bedrock_model_id:
        cfg["model_id"] = settings.bedrock_model_id
    return cfg


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


_MEDIA_TYPE_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


async def call_ingestion_llm(image_paths: list[Path]) -> tuple[dict, dict]:
    """
    Send recipe card image(s) to Claude via Bedrock for structured extraction.

    Returns:
        (raw_bedrock_response, parsed_recipe_dict)

    The raw_bedrock_response is stored verbatim in llm_outputs.raw_llm_response
    and intentionally NOT written to logs (avoids bloating NAS log volumes).
    """
    cfg = _load_settings()
    template_src = _load_prompt("ingestion_prompt.md")
    rendered = Template(template_src).render(num_images=len(image_paths))

    # Extract the system prompt — everything after the "## System" heading,
    # stripping the file-header comment lines that precede it.
    parts = rendered.split("## System", 1)
    system_prompt = ("## System" + parts[1]).strip() if len(parts) > 1 else rendered.strip()

    # Build vision content blocks — one image block per file, then a text request
    content_blocks: list[dict] = []
    for path in image_paths:
        media_type = _MEDIA_TYPE_MAP.get(path.suffix.lower(), "image/jpeg")
        image_data = base64.b64encode(path.read_bytes()).decode()
        content_blocks.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": image_data,
            },
        })

    content_blocks.append({
        "type": "text",
        "text": (
            "Extract all recipe information from the image(s) above and return "
            "it as valid JSON exactly matching the schema in the system prompt."
        ),
    })

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": cfg.get("max_tokens", 4096),
        "temperature": cfg.get("temperature", 0.2),
        "system": system_prompt,
        "messages": [{"role": "user", "content": content_blocks}],
    }

    client = _get_client()
    response = client.invoke_model(
        modelId=cfg["model_id"],
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    raw_response = json.loads(response["body"].read())

    text = raw_response["content"][0]["text"].strip()

    # Strip markdown code fences if the model wrapped the JSON
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    parsed = json.loads(text)

    # Structured trace log — first 200 chars only; full response in llm_outputs table
    usage = raw_response.get("usage", {})
    logger.info(
        "ingestion LLM call",
        extra={
            "model": raw_response.get("model", cfg.get("model_id")),
            "provider": "bedrock",
            "prompt_tokens": usage.get("input_tokens"),
            "completion_tokens": usage.get("output_tokens"),
            "status": "success",
            "title": parsed.get("title"),
            "ingredient_count": len(parsed.get("ingredients", [])),
            "step_count": len(parsed.get("steps", [])),
            "response_preview": text[:200],
        },
    )
    return raw_response, parsed
