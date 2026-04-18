"""
Outbound email via SMTP.

Sending is skipped gracefully when SMTP_HOST is not configured — useful in
local dev without a mail server. All send calls are fire-and-forget; errors
are logged but never raised to the caller.
"""
import asyncio
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings

logger = logging.getLogger(__name__)


def _send_sync(to: str, subject: str, body_html: str, body_text: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg.attach(MIMEText(body_text, "plain"))
    msg.attach(MIMEText(body_html, "html"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
        smtp.ehlo()
        if settings.smtp_port != 25:
            smtp.starttls()
        if settings.smtp_user and settings.smtp_password:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.sendmail(msg["From"], [to], msg.as_string())


async def send_password_reset(to_email: str, reset_token: str) -> None:
    if not settings.smtp_host:
        logger.warning("SMTP not configured — skipping password reset email", extra={"to": to_email})
        return

    reset_url = f"{settings.app_url}/reset-password?token={reset_token}"

    body_html = f"""
    <p>You requested a password reset for your WhatsForTea account.</p>
    <p><a href="{reset_url}">Click here to reset your password</a></p>
    <p>This link expires in 1 hour and can only be used once.</p>
    <p>If you didn't request this, you can safely ignore this email.</p>
    """

    body_text = (
        f"You requested a password reset for your WhatsForTea account.\n\n"
        f"Reset your password here: {reset_url}\n\n"
        f"This link expires in 1 hour and can only be used once.\n\n"
        f"If you didn't request this, you can safely ignore this email."
    )

    try:
        await asyncio.to_thread(_send_sync, to_email, "WhatsForTea — Reset your password", body_html, body_text)
        logger.info("Password reset email sent", extra={"to": to_email})
    except Exception as exc:
        logger.error("Failed to send password reset email", extra={"to": to_email, "error": str(exc)})
