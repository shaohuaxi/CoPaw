"""Configuration management for ADBPG Memory CLI.

Handles loading, saving, merging (CLI flags > env vars > config file),
validation, and sensitive field masking.
"""

import os
import json
from pathlib import Path
from typing import Any

CONFIG_DIR = Path.home() / ".adbpg-mem"
CONFIG_FILE = CONFIG_DIR / "config.json"

ENV_PREFIX = "ADBPG_MEM_"

# Environment variable to config key mapping
ENV_MAP: dict[str, str] = {
    "ADBPG_MEM_API_MODE": "api_mode",
    "ADBPG_MEM_HOST": "host",
    "ADBPG_MEM_PORT": "port",
    "ADBPG_MEM_USER": "user",
    "ADBPG_MEM_PASSWORD": "password",
    "ADBPG_MEM_DBNAME": "dbname",
    "ADBPG_MEM_REST_API_KEY": "rest_api_key",
    "ADBPG_MEM_REST_BASE_URL": "rest_base_url",
    "ADBPG_MEM_USER_ID": "user_id",
}

# Required fields per api_mode
SQL_REQUIRED_FIELDS = ("host", "port", "user", "password", "dbname")
REST_REQUIRED_FIELDS = ("rest_base_url", "rest_api_key")


def load_config(config_file: Path | None = None) -> dict[str, Any]:
    """Load configuration from the JSON config file.

    Returns an empty dict if the file does not exist.
    """
    path = config_file if config_file is not None else CONFIG_FILE
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_config(config: dict[str, Any], config_file: Path | None = None) -> None:
    """Save configuration to the JSON config file.

    Creates the config directory if it does not exist.
    """
    path = config_file if config_file is not None else CONFIG_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def _load_env_config() -> dict[str, Any]:
    """Load configuration values from environment variables.

    Only includes env vars that are actually set. Converts port to int.
    """
    env_config: dict[str, Any] = {}
    for env_var, config_key in ENV_MAP.items():
        value = os.environ.get(env_var)
        if value is not None:
            if config_key == "port":
                try:
                    env_config[config_key] = int(value)
                except ValueError:
                    env_config[config_key] = value
            else:
                env_config[config_key] = value
    return env_config


def merge_config(
    config_file: Path | None = None, **cli_flags: Any
) -> dict[str, Any]:
    """Merge configuration from three layers (highest to lowest priority):

    1. CLI flags (only non-None values)
    2. Environment variables (only set vars)
    3. Config file

    Returns the merged configuration dict.
    """
    # Layer 3: config file (lowest priority)
    file_config = load_config(config_file)

    # Layer 2: environment variables
    env_config = _load_env_config()

    # Layer 1: CLI flags (highest priority) — filter out None values
    cli_config = {k: v for k, v in cli_flags.items() if v is not None}

    # Merge: file < env < cli
    merged = {}
    merged.update(file_config)
    merged.update(env_config)
    merged.update(cli_config)
    return merged


def mask_sensitive(config: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of config with sensitive fields masked.

    Any key containing 'password' or 'api_key' will have its value
    replaced with the first 4 characters followed by '***',
    or just '***' if the value is 4 characters or fewer.
    """
    masked = {}
    for key, value in config.items():
        if ("password" in key or "api_key" in key) and isinstance(value, str) and value:
            if len(value) <= 4:
                masked[key] = "***"
            else:
                masked[key] = value[:4] + "***"
        else:
            masked[key] = value
    return masked


def validate_config(config: dict[str, Any]) -> tuple[bool, list[str]]:
    """Validate configuration based on api_mode.

    SQL mode requires: host, port, user, password, dbname.
    REST mode requires: rest_base_url, rest_api_key.
    Empty string or missing counts as invalid.

    Returns (is_valid, errors) where errors is a list of error messages.
    """
    errors: list[str] = []
    api_mode = config.get("api_mode", "")

    if not api_mode:
        errors.append("api_mode is required")
        return False, errors

    if api_mode not in ("sql", "rest"):
        errors.append(f"api_mode must be 'sql' or 'rest', got '{api_mode}'")
        return False, errors

    if api_mode == "sql":
        required = SQL_REQUIRED_FIELDS
    else:
        required = REST_REQUIRED_FIELDS

    for field in required:
        value = config.get(field)
        if value is None or (isinstance(value, str) and value == ""):
            errors.append(f"'{field}' is required for {api_mode} mode")

    return len(errors) == 0, errors
