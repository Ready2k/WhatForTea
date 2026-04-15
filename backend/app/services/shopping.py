import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shopping import ShoppingListItem


async def add_item(
    household_id: uuid.UUID,
    raw_name: str,
    quantity: float,
    unit: str,
    db: AsyncSession,
) -> ShoppingListItem:
    item = ShoppingListItem(
        id=uuid.uuid4(),
        household_id=household_id,
        raw_name=raw_name.strip(),
        quantity=quantity,
        unit=unit,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def get_items(household_id: uuid.UUID, db: AsyncSession) -> list[ShoppingListItem]:
    result = await db.execute(
        select(ShoppingListItem)
        .where(ShoppingListItem.household_id == household_id)
        .order_by(ShoppingListItem.done, ShoppingListItem.added_at)
    )
    return list(result.scalars().all())


async def mark_done(item_id: uuid.UUID, done: bool, db: AsyncSession) -> Optional[ShoppingListItem]:
    item = await db.get(ShoppingListItem, item_id)
    if item is None:
        return None
    item.done = done
    await db.commit()
    await db.refresh(item)
    return item


async def delete_item(item_id: uuid.UUID, db: AsyncSession) -> bool:
    item = await db.get(ShoppingListItem, item_id)
    if item is None:
        return False
    await db.delete(item)
    await db.commit()
    return True


async def clear_done(household_id: uuid.UUID, db: AsyncSession) -> int:
    result = await db.execute(
        select(ShoppingListItem).where(
            ShoppingListItem.household_id == household_id,
            ShoppingListItem.done.is_(True),
        )
    )
    items = list(result.scalars().all())
    for item in items:
        await db.delete(item)
    await db.commit()
    return len(items)
