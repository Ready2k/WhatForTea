import logging
import uuid
from pathlib import Path
from typing import Optional

from PIL import Image
from fastapi import UploadFile

logger = logging.getLogger(__name__)

async def rotate_image(path: Path, degrees: int = -90) -> bool:
    """
    Rotate image at path by the given degrees (default -90 for 90deg clockwise).
    Overwrites the original file.
    """
    if not path.exists():
        logger.error(f"Cannot rotate image: file not found at {path}")
        return False

    try:
        # Load, rotate, and save
        with Image.open(path) as img:
            # We want to use EXIF orientation to avoid unexpected results, 
            # but for a manual rotate command, a simple transpose/rotate is fine.
            rotated = img.rotate(degrees, expand=True)
            rotated.save(path)
        
        logger.info(f"Image rotated successfully: {path}")
        return True
    except Exception as e:
        logger.error(f"Failed to rotate image {path}: {e}")
        return False

async def save_manual_photo(
    recipe_id: uuid.UUID, 
    file: UploadFile, 
    image_dir: Path
) -> Optional[Path]:
    """
    Save an uploaded file as the manual hero photo for a recipe.
    Naming it 'image_manual.jpg' (or suffix) to avoid clashing with scanned 'image_00.jpg'.
    """
    try:
        image_dir.mkdir(parents=True, exist_ok=True)
        
        suffix = Path(file.filename).suffix if file.filename else ".jpg"
        dest = image_dir / f"manual_hero_{uuid.uuid4().hex[:8]}{suffix}"
        
        content = await file.read()
        dest.write_bytes(content)
        
        logger.info(f"Manual photo saved for recipe {recipe_id}: {dest}")
        return dest
    except Exception as e:
        logger.error(f"Failed to save manual photo for recipe {recipe_id}: {e}")
        return None
