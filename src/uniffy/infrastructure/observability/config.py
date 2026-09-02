from enum import StrEnum
from typing import Literal

from pydantic import BaseModel


class LogLevel(StrEnum):
    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    CRITICAL = "CRITICAL"


class LoggingConfig(BaseModel):
    app_name: str
    app_version: str
    console_log_level: LogLevel = LogLevel.INFO
    console_log_type: Literal["json", "console"] = "console"
