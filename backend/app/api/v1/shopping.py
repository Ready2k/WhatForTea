import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services import shopping as svc

router = APIRouter(prefix="/api/v1/shopping-list", tags=["shopping"])


class ItemCreate(BaseModel):
    raw_name: str
    quantity: float = 1.0
    unit: str = "count"


class ItemPatch(BaseModel):
    done: bool


class ItemOut(BaseModel):
    id: uuid.UUID
    raw_name: str
    quantity: float
    unit: str
    done: bool
    added_at: str

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_item(cls, item):
        return cls(
            id=item.id,
            raw_name=item.raw_name,
            quantity=item.quantity,
            unit=item.unit,
            done=item.done,
            added_at=item.added_at.isoformat(),
        )


def _household_id(request: Request) -> uuid.UUID:
    hid = getattr(request.state, "household_id", None)
    if not hid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uuid.UUID(str(hid))


@router.get("", response_model=list[ItemOut])
async def list_items(request: Request, db: AsyncSession = Depends(get_db)):
    hid = _household_id(request)
    items = await svc.get_items(hid, db)
    return [ItemOut.from_orm_item(i) for i in items]


@router.post("", response_model=ItemOut, status_code=201)
async def create_item(body: ItemCreate, request: Request, db: AsyncSession = Depends(get_db)):
    hid = _household_id(request)
    item = await svc.add_item(hid, body.raw_name, body.quantity, body.unit, db)
    return ItemOut.from_orm_item(item)


@router.patch("/{item_id}", response_model=ItemOut)
async def patch_item(item_id: uuid.UUID, body: ItemPatch, db: AsyncSession = Depends(get_db)):
    item = await svc.mark_done(item_id, body.done, db)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return ItemOut.from_orm_item(item)


@router.delete("/{item_id}", status_code=204)
async def delete_item(item_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    deleted = await svc.delete_item(item_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Item not found")


@router.delete("/done/clear", status_code=204)
async def clear_done_items(request: Request, db: AsyncSession = Depends(get_db)):
    hid = _household_id(request)
    await svc.clear_done(hid, db)
