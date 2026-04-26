"""add google oauth columns to users

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-04-26 10:00:00.000000
"""
import sqlalchemy as sa
from alembic import op

revision = "o5p6q7r8s9t0"
down_revision = "n4o5p6q7r8s9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("users", "password_hash", nullable=True)
    op.add_column("users", sa.Column("oauth_provider", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("oauth_sub", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_users_oauth_sub", "users", ["oauth_sub"])


def downgrade() -> None:
    op.drop_constraint("uq_users_oauth_sub", "users", type_="unique")
    op.drop_column("users", "oauth_sub")
    op.drop_column("users", "oauth_provider")
    op.alter_column("users", "password_hash", nullable=False)
