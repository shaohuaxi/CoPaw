"""Output formatting for ADBPG Memory CLI.

Supports five output modes: text, json, table, quiet, agent.
Provides unified formatting for command results and errors.
"""

import json
from typing import Any


VALID_MODES = ("text", "json", "table", "quiet", "agent")


def truncate_content(text: str, max_length: int = 80) -> str:
    """Truncate text to max_length characters.

    If text is longer than max_length, truncate and append '...'
    The truncated portion (before the ellipsis) is at most max_length characters.
    If text is max_length or shorter, return as-is.
    """
    if len(text) <= max_length:
        return text
    return text[:max_length] + "..."


class OutputFormatter:
    """Unified output formatter supporting text/json/table/quiet/agent modes."""

    VALID_MODES = VALID_MODES

    def __init__(self, mode: str = "text"):
        if mode not in self.VALID_MODES:
            raise ValueError(
                f"Invalid output mode: {mode!r}. Must be one of {self.VALID_MODES}"
            )
        self.mode = mode

    @property
    def is_machine(self) -> bool:
        """True for json, agent, quiet modes (suppress interactive elements)."""
        return self.mode in ("json", "agent", "quiet")

    def format_result(
        self,
        command: str,
        data: Any,
        scope: dict[str, Any],
        duration_ms: int,
        count: int | None = None,
    ) -> str:
        """Format output based on current mode."""
        if self.mode == "agent":
            return self._format_agent_envelope(command, data, scope, duration_ms, count)
        elif self.mode == "json":
            return json.dumps(data, ensure_ascii=False)
        elif self.mode == "quiet":
            return self._format_quiet(data, count)
        elif self.mode == "table":
            return self._format_table(data)
        else:  # text
            return self._format_text(data)

    def format_error(
        self,
        command: str,
        error: str,
        scope: dict[str, Any],
        duration_ms: int,
    ) -> str:
        """Format error output. In agent mode, returns JSON envelope with status=error."""
        if self.mode == "agent":
            return json.dumps(
                {
                    "status": "error",
                    "command": command,
                    "duration_ms": duration_ms,
                    "scope": scope,
                    "count": 0,
                    "data": None,
                    "error": error,
                },
                ensure_ascii=False,
            )
        elif self.mode == "json":
            return json.dumps({"error": error}, ensure_ascii=False)
        else:
            return f"Error: {error}"

    def _format_agent_envelope(
        self,
        command: str,
        data: Any,
        scope: dict[str, Any],
        duration_ms: int,
        count: int | None,
    ) -> str:
        return json.dumps(
            {
                "status": "ok",
                "command": command,
                "duration_ms": duration_ms,
                "scope": scope,
                "count": count,
                "data": data,
            },
            ensure_ascii=False,
        )

    def _format_quiet(self, data: Any, count: int | None) -> str:
        if count is not None:
            return str(count)
        if isinstance(data, list):
            return "\n".join(
                str(item.get("id", "")) for item in data if isinstance(item, dict)
            )
        return str(data)

    def _format_table(self, data: Any) -> str:
        if not isinstance(data, list) or not data:
            return str(data)
        headers = list(data[0].keys()) if isinstance(data[0], dict) else []
        if not headers:
            return str(data)
        lines = [" | ".join(headers)]
        lines.append(" | ".join("-" * len(h) for h in headers))
        for row in data:
            lines.append(" | ".join(str(row.get(h, "")) for h in headers))
        return "\n".join(lines)

    def _format_text(self, data: Any) -> str:
        if isinstance(data, list):
            return "\n".join(str(item) for item in data)
        return str(data)
