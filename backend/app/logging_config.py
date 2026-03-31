import logging
import sys

from pythonjsonlogger.json import JsonFormatter


def setup_logging(log_level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    formatter = JsonFormatter(
        fmt="%(asctime)s %(name)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
        rename_fields={"levelname": "level", "asctime": "timestamp"},
    )
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.setLevel(log_level.upper())
    root.handlers = []
    root.addHandler(handler)

    # Quiet noisy libs
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
