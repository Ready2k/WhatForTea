import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class UserProfile(BaseModel):
    id: uuid.UUID
    username: str
    display_name: str
    email: Optional[str] = None
    household_id: uuid.UUID
    is_admin: bool
    force_password_change: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class HouseholdInfo(BaseModel):
    id: uuid.UUID
    name: str
    invite_code: str
    member_count: int


class JoinRequest(BaseModel):
    invite_code: str
    username: str
    display_name: str
    password: str
    email: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str
