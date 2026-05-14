"""Per-agent configuration for ADBPG Memory CLI.

Stores agent-specific settings under ``~/.adbpg-mem/agents/<agent_id>.json``
with file mode ``0600``. Schema:

    isolation_agent:    bool, default False
    isolation_run_mode: enum {"off","manual","auto","tag"}, default "off"
    current_run_id:     str, optional (omitted from defaults)

Unknown keys or values that do not satisfy the schema raise
``AgentConfigError`` so the CLI can surface ``status=error``.
"""

import json
import os
import re
from pathlib import Path
from typing import Any

from .config import CONFIG_DIR

AGENTS_DIR = CONFIG_DIR / "agents"

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

VALID_KEYS = ("isolation_agent", "isolation_run_mode", "current_run_id")
VALID_RUN_MODES = ("off", "manual", "auto", "tag")

DEFAULTS: dict[str, Any] = {
    "isolation_agent": False,
    "isolation_run_mode": "off",
}

_AGENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class AgentConfigError(ValueError):
    """Raised for any schema/validation failure in agent-config commands."""


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def validate_agent_id(agent_id: str | None) -> str:
    """Return ``agent_id`` if valid, otherwise raise ``AgentConfigError``.

    Empty/None is treated as missing rather than an invalid format so callers
    can surface the user-facing "agent-config commands require -a <agent_id>"
    error separately.
    """
    if agent_id is None or agent_id == "":
        raise AgentConfigError("agent-config commands require -a <agent_id>")
    if len(agent_id) > 64:
        raise AgentConfigError(
            f"invalid agent_id format: length {len(agent_id)} exceeds max 64"
        )
    if not _AGENT_ID_RE.match(agent_id):
        raise AgentConfigError(
            "invalid agent_id format: only [A-Za-z0-9_-] characters are allowed"
        )
    return agent_id


def _coerce_value(key: str, value: Any) -> Any:
    """Coerce a CLI-provided string value into the schema-typed value.

    Non-string inputs (e.g. already-typed values from tests) are validated
    against the schema as-is. Raises ``AgentConfigError`` on type mismatch.
    """
    if key == "isolation_agent":
        # Native bools (used by the Python API / tests) are accepted as-is.
        # Strings must be exactly "true"/"false" (case-insensitive) — values
        # like "1"/"0"/"yes"/"no" are rejected to keep parity with the Node
        # implementation (see adbpg-memory-cli/node/src/agent-config.js: the
        # `bool` parser only accepts true/false). The error message text is
        # an explicit cross-impl contract.
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.lower()
            if lowered == "true":
                return True
            if lowered == "false":
                return False
            raise AgentConfigError(
                f"invalid value for isolation_agent: expected 'true' or 'false', got '{value}'"
            )
        raise AgentConfigError(
            f"invalid value for isolation_agent: expected 'true' or 'false', got '{value}'"
        )

    if key == "isolation_run_mode":
        if not isinstance(value, str):
            raise AgentConfigError(
                f"invalid value for isolation_run_mode: expected string, got {type(value).__name__}"
            )
        if value not in VALID_RUN_MODES:
            raise AgentConfigError(
                f"invalid value for isolation_run_mode: must be one of "
                f"{list(VALID_RUN_MODES)}, got {value!r}"
            )
        return value

    if key == "current_run_id":
        if not isinstance(value, str):
            raise AgentConfigError(
                f"invalid value for current_run_id: expected string, got {type(value).__name__}"
            )
        if value == "":
            raise AgentConfigError(
                "invalid value for current_run_id: must be non-empty"
            )
        return value

    raise AgentConfigError(f"unknown key: {key!r}")


def validate_key(key: str) -> str:
    if key not in VALID_KEYS:
        raise AgentConfigError(f"unknown key: {key!r}")
    return key


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def _agent_file(agent_id: str, agents_dir: Path | None = None) -> Path:
    base = agents_dir if agents_dir is not None else AGENTS_DIR
    return base / f"{agent_id}.json"


def _load_raw(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_raw(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Use os.open with mode 0600 so the file is created with restrictive
    # permissions on POSIX. On Windows the mode argument is ignored.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception:
        # Best-effort cleanup if fdopen raised after os.open succeeded.
        try:
            os.close(fd)
        except OSError:
            pass
        raise
    # Defensive: ensure mode is 0600 even if file pre-existed with looser mode.
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def show_agent_config(
    agent_id: str, agents_dir: Path | None = None
) -> dict[str, Any]:
    """Return the merged config for ``agent_id`` (defaults + stored overrides).

    Missing file → defaults only (current_run_id absent).
    """
    validate_agent_id(agent_id)
    stored = _load_raw(_agent_file(agent_id, agents_dir))
    merged: dict[str, Any] = dict(DEFAULTS)
    for k in VALID_KEYS:
        if k in stored:
            merged[k] = stored[k]
    return merged


def get_agent_config(
    agent_id: str, key: str, agents_dir: Path | None = None
) -> Any:
    """Return a single key value for ``agent_id``.

    Falls back to the schema default. If the key has no default and is unset,
    returns ``None``.
    """
    validate_agent_id(agent_id)
    validate_key(key)
    stored = _load_raw(_agent_file(agent_id, agents_dir))
    if key in stored:
        return stored[key]
    return DEFAULTS.get(key)


def set_agent_config(
    agent_id: str, key: str, value: Any, agents_dir: Path | None = None
) -> Any:
    """Persist ``key=value`` for ``agent_id``. Returns the coerced value."""
    validate_agent_id(agent_id)
    validate_key(key)
    coerced = _coerce_value(key, value)
    path = _agent_file(agent_id, agents_dir)
    stored = _load_raw(path)
    stored[key] = coerced
    _save_raw(path, stored)
    return coerced


def unset_agent_config(
    agent_id: str, key: str, agents_dir: Path | None = None
) -> None:
    """Delete ``key`` from the agent config (idempotent)."""
    validate_agent_id(agent_id)
    validate_key(key)
    path = _agent_file(agent_id, agents_dir)
    if not path.exists():
        return
    stored = _load_raw(path)
    if key in stored:
        del stored[key]
        _save_raw(path, stored)
