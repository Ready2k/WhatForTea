from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    database_url: str

    # Redis
    redis_url: str = "redis://redis:6379"

    # AWS Bedrock
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"
    bedrock_model_id: str = "us.anthropic.claude-sonnet-4-6"          # vision tasks
    bedrock_text_model_id: str = "us.anthropic.claude-haiku-4-5-20251001-v1:0"  # text/chat tasks

    # Auth
    jwt_secret: str = "dev-secret-change-in-production"
    household_username: str = "household"
    household_password_hash: str = ""
    cookie_secure: bool = False  # set True in production (requires HTTPS)

    # Observability
    log_level: str = "INFO"
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "https://cloud.langfuse.com"


settings = Settings()
