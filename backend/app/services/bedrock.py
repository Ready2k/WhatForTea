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
try:
    from langfuse.decorators import langfuse_context, observe
except ImportError:
    # Fallback to no-op decorators if langfuse is not installed
    def observe(*args, **kwargs):
        def wrapper(func):
            return func
        return wrapper
    langfuse_context = None

logger = logging.getLogger(__name__)

_AGENT_CONFIG_DIR = Path(__file__).parent.parent.parent / "agent_config"


@lru_cache(maxsize=1)
def _load_settings() -> dict:
    path = _AGENT_CONFIG_DIR / "agent_settings.yaml"
    with open(path) as f:
        cfg = yaml.safe_load(f)
    # .env overrides take priority over agent_settings.yaml so model IDs can be
    # changed without a code or config-file deployment — just update .env and restart.
    from app.config import settings
    if settings.bedrock_model_id:
        cfg["vision_model_id"] = settings.bedrock_model_id
    if settings.bedrock_text_model_id:
        cfg["text_model_id"] = settings.bedrock_text_model_id
    return cfg


def _model_id(vision: bool = False) -> str:
    """Return the appropriate model ID for vision vs text tasks."""
    cfg = _load_settings()
    if vision:
        return cfg.get("vision_model_id") or cfg.get("model_id", "us.anthropic.claude-sonnet-4-6")
    return cfg.get("text_model_id") or cfg.get("model_id", "us.anthropic.claude-haiku-4-5-20251001-v1:0")


def _load_prompt(filename: str) -> str:
    path = _AGENT_CONFIG_DIR / filename
    with open(path) as f:
        return f.read()


def _get_client():
    from app.config import settings
    client = boto3.client(
        "bedrock-runtime",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
        endpoint_url=settings.aws_endpoint_url or None,
    )

    # If using a mock/proxy, override the Host header for signing so SigV4 is valid for real AWS
    if settings.aws_endpoint_url:
        def before_sign(request, **kwargs):
            real_host = f"bedrock-runtime.{settings.aws_region}.amazonaws.com"
            request.headers["Host"] = real_host
            print(f"DEBUG: SigV4 Host override: {real_host}")
            print(f"DEBUG: Headers: {list(request.headers.keys())}")

        client.meta.events.register("before-sign", before_sign)

    return client


async def _call_ollama(system_prompt: str, user_text: str) -> str:
    """Helper to call Ollama API directly via httpx."""
    from app.config import settings
    import httpx
    
    url = f"{settings.ollama_base_url}/api/chat"
    payload = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_text},
        ],
        "stream": False,
        "options": {"temperature": 0.1}
    }
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["message"]["content"]


@observe(as_type="generation", name="nutrition_llm")
async def call_nutrition_llm(title: str, ingredients: list[dict], base_servings: int) -> dict:
    """
    Estimate macro-nutrients for a recipe.
    Returns a dict: {calories_kcal, protein_g, fat_g, carbs_g, fibre_g, per_servings}
    """
    model = _model_id(vision=False)
    template_src = _load_prompt("nutrition_prompt.md")
    parts = template_src.split("## System", 1)
    system_prompt = ("## System" + parts[1]).strip() if len(parts) > 1 else template_src.strip()

    ingredient_lines = "\n".join(
        f"- {ing.get('quantity', '')} {ing.get('unit', '') or ''} {ing.get('raw_name', '')}".strip()
        for ing in ingredients
    )
    user_text = (
        f"Recipe: {title}\n"
        f"Servings: {base_servings}\n\n"
        f"Ingredients:\n{ingredient_lines}\n\n"
        "Estimate the nutrition per serving and return JSON matching the schema."
    )

    from app.config import settings
    if settings.llm_provider == "ollama":
        text = await _call_ollama(system_prompt, user_text)
    else:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 512,
            "temperature": 0.1,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_text}],
        }

        client = _get_client()
        response = client.invoke_model(
            modelId=model,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        raw = json.loads(response["body"].read())
        text = raw["content"][0]["text"].strip()

    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()
    result = json.loads(text)
    
    if settings.llm_provider != "ollama":
        usage = raw.get("usage", {})
        langfuse_context.update_current_observation(
            model=model,
            input={"title": title, "servings": base_servings, "ingredients": ingredients},
            output=result,
            usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
        )
    return result


@observe(as_type="generation", name="url_ingestion_llm")
async def call_url_ingestion_llm(page_text: str, source_domain: str) -> tuple[dict, dict]:
    """
    Extract a structured recipe from the plain-text content of a recipe web page.

    Returns:
        (raw_bedrock_response, parsed_recipe_dict)
    """
    cfg = _load_settings()
    model = _model_id(vision=False)
    template_src = _load_prompt("url_ingestion_prompt.md")
    rendered = Template(template_src).render(source_domain=source_domain)

    parts = rendered.split("## System", 1)
    system_prompt = ("## System" + parts[1]).strip() if len(parts) > 1 else rendered.strip()

    # Truncate page text to avoid exceeding token limits (~32k chars ≈ ~8k tokens)
    truncated = page_text[:32000]

    from app.config import settings
    if settings.llm_provider == "ollama":
        text = await _call_ollama(system_prompt, f"Here is the text content of a recipe page from {source_domain}:\n\n{truncated}\n\nExtract the recipe and return valid JSON exactly matching the schema in the system prompt.")
        raw_response = {"content": [{"text": text}], "model": settings.ollama_model}
    else:
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": cfg.get("max_tokens", 4096),
            "temperature": cfg.get("temperature", 0.2),
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": (
                        f"Here is the text content of a recipe page from {source_domain}:\n\n"
                        f"{truncated}\n\n"
                        "Extract the recipe and return valid JSON exactly matching the schema in the system prompt."
                    ),
                }
            ],
        }

        client = _get_client()
        response = client.invoke_model(
            modelId=model,
            body=json.dumps(body),
            contentType="application/json",
            accept="application/json",
        )
        raw_response = json.loads(response["body"].read())

    text = raw_response["content"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    parsed = json.loads(text)

    if settings.llm_provider != "ollama":
        usage = raw_response.get("usage", {})
        langfuse_context.update_current_observation(
            model=raw_response.get("model", model),
            input={"source_domain": source_domain, "page_text_preview": page_text[:500]},
            output={"title": parsed.get("title"), "ingredient_count": len(parsed.get("ingredients", [])), "step_count": len(parsed.get("steps", []))},
            usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
        )
    return raw_response, parsed


@observe(as_type="generation", name="voice_command_llm")
async def call_voice_command_llm(transcript: str, context: str | None = None) -> dict:
    """
    Parse a voice transcript into a structured command intent.
    Returns a dict with keys: intent, item, note, direction.
    """
    model = _model_id(vision=False)
    system_prompt = _load_prompt("voice_command_prompt.md")

    context_hint = f"\nContext: {context}" if context else ""
    user_text = f'Transcript: "{transcript}"{context_hint}\n\nReturn JSON matching the schema.'

    from app.config import settings
    try:
        if settings.llm_provider == "ollama":
            text = await _call_ollama(system_prompt, user_text)
            raw = {"content": [{"text": text}]}
        else:
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 256,
                "temperature": 0.1,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_text}],
            }

            client = _get_client()
            response = client.invoke_model(
                modelId=model,
                body=json.dumps(body),
                contentType="application/json",
                accept="application/json",
            )
            raw = json.loads(response["body"].read())

        text = raw["content"][0]["text"].strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        parsed = json.loads(text)
        
        if settings.llm_provider != "ollama":
            usage = raw.get("usage", {})
            intent = parsed.get("intent", "unknown")
            langfuse_context.update_current_observation(
                model=model,
                input={"transcript": transcript, "context": context},
                output=parsed,
                usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
                metadata={
                    "intent": intent,
                    "model": model,
                    "input_tokens": usage.get("input_tokens"),
                    "output_tokens": usage.get("output_tokens"),
                },
            )
        return parsed
    except Exception as exc:
        logger.warning("voice command LLM failed", extra={"error": str(exc)})
        return {"intent": "unknown"}


@observe(as_type="generation", name="normaliser_llm")
async def call_normaliser_llm(raw_name: str, candidate: str) -> dict[str, Any]:
    """
    Ask the LLM whether raw_name matches the candidate canonical ingredient.
    Returns {"match": bool, "confidence": float, "reasoning": str}
    """
    cfg = _load_settings()
    model = _model_id(vision=False)
    template_src = _load_prompt("normaliser_prompt.md")

    # Render template variables
    rendered = Template(template_src).render(raw_name=raw_name, candidate=candidate)

    # Extract system + user parts from rendered prompt
    parts = rendered.split("## Task", 1)
    system_prompt = parts[0].replace("## System", "").strip()
    user_prompt = ("## Task" + parts[1]).strip() if len(parts) > 1 else rendered.strip()

    from app.config import settings
    try:
        if settings.llm_provider == "ollama":
            text = await _call_ollama(system_prompt, user_prompt)
            result_body = {"content": [{"text": text}]}
        else:
            body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 256,
                "temperature": cfg.get("temperature", 0.1),
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            }

            client = _get_client()
            response = client.invoke_model(
                modelId=model,
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
        
        if settings.llm_provider != "ollama":
            usage = result_body.get("usage", {})
            langfuse_context.update_current_observation(
                model=model,
                input={"raw_name": raw_name, "candidate": candidate},
                output=parsed,
                usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
            )
        return parsed
    except Exception as exc:
        print(f"DEBUG EXCEPTION in normaliser: {exc}")
        logger.warning("normaliser LLM call failed", extra={"error": str(exc)})
        return {"match": False, "confidence": 0.0, "reasoning": f"LLM error: {exc}"}


_MEDIA_TYPE_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


@observe(as_type="generation", name="receipt_llm")
async def call_receipt_llm(
    image_paths: list[Path] | None,
    text_content: str | None,
) -> tuple[dict, list[dict]]:
    """
    Extract food/drink line items from a receipt image or plain text.

    Returns:
        (raw_bedrock_response, list of {raw_name, quantity, unit} dicts)
    """
    cfg = _load_settings()
    model = _model_id(vision=bool(image_paths))
    system_prompt = _load_prompt("receipt_prompt.md")

    content_blocks: list[dict] = []

    if image_paths:
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
            "text": "Extract all food and drink line items from the receipt image(s) above and return the JSON array.",
        })
    else:
        content_blocks.append({
            "type": "text",
            "text": (
                f"Here is the text content of a grocery order or receipt:\n\n{text_content}\n\n"
                "Extract all food and drink line items and return the JSON array."
            ),
        })

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "temperature": 0.1,
        "system": system_prompt,
        "messages": [{"role": "user", "content": content_blocks}],
    }

    client = _get_client()
    response = client.invoke_model(
        modelId=model,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    raw_response = json.loads(response["body"].read())

    text = raw_response["content"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    parsed = json.loads(text)
    if not isinstance(parsed, list):
        parsed = []

    usage = raw_response.get("usage", {})
    langfuse_context.update_current_observation(
        model=raw_response.get("model", model),
        input={"source": "image" if image_paths else "text", "image_count": len(image_paths) if image_paths else 0},
        output={"item_count": len(parsed), "items": parsed},
        usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
    )
    logger.info(
        "receipt LLM call",
        extra={
            "model": raw_response.get("model", cfg.get("model_id")),
            "prompt_tokens": usage.get("input_tokens"),
            "completion_tokens": usage.get("output_tokens"),
            "item_count": len(parsed),
            "source": "image" if image_paths else "text",
        },
    )
    return raw_response, parsed


@observe(as_type="generation", name="auto_crop_llm")
async def call_auto_crop_llm(image_path: Path) -> dict:
    """
    Ask Claude vision to identify the food photograph bounding box within a recipe card image.
    Returns {x, y, width, height} as fractions (0.0–1.0) of the image dimensions.
    """
    model = _model_id(vision=True)
    media_type = _MEDIA_TYPE_MAP.get(image_path.suffix.lower(), "image/jpeg")
    image_data = base64.b64encode(image_path.read_bytes()).decode()

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 256,
        "temperature": 0.1,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_data},
                    },
                    {
                        "type": "text",
                        "text": (
                            "This is a photo of a physical HelloFresh recipe card. "
                            "Identify the bounding box of the main food photograph — "
                            "the area showing the finished dish — excluding recipe text, "
                            "ingredient lists, logos, step numbers, borders, and background. "
                            "Return ONLY valid JSON with this exact schema, no other text:\n"
                            '{"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}\n'
                            "Where x and y are the top-left corner and width/height are the "
                            "size, all as fractions of the total image dimensions (0.0–1.0). "
                            "If the image is already a clean food photo with no card content, "
                            "return {\"x\":0,\"y\":0,\"width\":1,\"height\":1}."
                        ),
                    },
                ],
            }
        ],
    }

    client = _get_client()
    response = client.invoke_model(
        modelId=model,
        body=json.dumps(body),
        contentType="application/json",
        accept="application/json",
    )
    raw = json.loads(response["body"].read())
    text = raw["content"][0]["text"].strip()
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
        text = text.strip()

    result = json.loads(text)
    # Clamp to valid range and ensure width/height are positive
    crop = {
        "x":      max(0.0, min(1.0,  float(result.get("x", 0.0)))),
        "y":      max(0.0, min(1.0,  float(result.get("y", 0.0)))),
        "width":  max(0.05, min(1.0, float(result.get("width", 1.0)))),
        "height": max(0.05, min(1.0, float(result.get("height", 1.0)))),
    }

    usage = raw.get("usage", {})
    langfuse_context.update_current_observation(
        model=model,
        input={"image": image_path.name},
        output=crop,
        usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
    )
    logger.info("auto_crop LLM", extra={"image": image_path.name, "crop": crop})
    return crop



async def call_ingestion_llm(image_paths: list[Path], kit_brand: str = "auto") -> tuple[dict, dict]:
    """
    Send recipe card image(s) to Claude via Bedrock for structured extraction.

    Returns:
        (raw_bedrock_response, parsed_recipe_dict)

    The raw_bedrock_response is stored verbatim in llm_outputs.raw_llm_response
    and intentionally NOT written to logs (avoids bloating NAS log volumes).
    """
    cfg = _load_settings()
    model = _model_id(vision=True)
    template_src = _load_prompt("ingestion_prompt.md")
    rendered = Template(template_src).render(num_images=len(image_paths), kit_brand=kit_brand)

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
        modelId=model,
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
    langfuse_context.update_current_observation(
        model=raw_response.get("model", model),
        input={"image_count": len(image_paths)},
        output={"title": parsed.get("title"), "ingredient_count": len(parsed.get("ingredients", [])), "step_count": len(parsed.get("steps", []))},
        usage={"input": usage.get("input_tokens"), "output": usage.get("output_tokens")},
    )
    logger.info(
        "ingestion LLM call",
        extra={
            "model": raw_response.get("model", model),
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
