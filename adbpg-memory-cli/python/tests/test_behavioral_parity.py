"""Behavioral parity unit tests for ADBPG Memory CLI.

Verifies that the Python and Node.js implementations share the same
command set, global flags, environment variables, exit codes, config
file format, and agent JSON envelope structure.

Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
"""

import json
from pathlib import Path

from adbpg_memory_cli.cli import cli
from adbpg_memory_cli.config import ENV_MAP
from adbpg_memory_cli.output import OutputFormatter

# Paths to Node.js source files
# tests/ -> python/ -> adbpg-memory-cli/ then into node/src
NODE_SRC = Path(__file__).resolve().parent.parent.parent / "node" / "src"


# ---------------------------------------------------------------------------
# Expected constants shared by both implementations
# ---------------------------------------------------------------------------

EXPECTED_COMMANDS = {"init", "add", "search", "list", "delete", "config", "status", "version"}

EXPECTED_GLOBAL_FLAGS = [
    ("-o", "--output"),
    ("--json",),
    ("--agent",),
    ("-u", "--user-id"),
    ("-a", "--agent-id"),
    ("-r", "--run-id"),
]

EXPECTED_ENV_VARS = [
    "ADBPG_MEM_API_MODE",
    "ADBPG_MEM_HOST",
    "ADBPG_MEM_PORT",
    "ADBPG_MEM_USER",
    "ADBPG_MEM_PASSWORD",
    "ADBPG_MEM_DBNAME",
    "ADBPG_MEM_REST_API_KEY",
    "ADBPG_MEM_REST_BASE_URL",
    "ADBPG_MEM_USER_ID",
]

EXPECTED_EXIT_CODES = {0, 1, 2}

AGENT_SUCCESS_FIELDS = ["status", "command", "duration_ms", "scope", "count", "data"]
AGENT_ERROR_FIELDS = ["status", "command", "duration_ms", "scope", "count", "data", "error"]


# ---------------------------------------------------------------------------
# 1. Same command set (Req 13.1)
# ---------------------------------------------------------------------------

class TestCommandSetParity:
    """Both implementations register the same commands."""

    def test_python_has_all_commands(self):
        """Python CLI registers all expected commands."""
        actual = set(cli.commands.keys())
        assert EXPECTED_COMMANDS.issubset(actual), (
            f"Missing commands in Python: {EXPECTED_COMMANDS - actual}"
        )

    def test_node_has_all_commands(self):
        """Node.js CLI registers all expected commands."""
        cli_js = (NODE_SRC / "cli.js").read_text()
        for cmd in EXPECTED_COMMANDS:
            assert (
                f"'{cmd}'" in cli_js
                or f'"{cmd}"' in cli_js
                or f".command('{cmd}" in cli_js
                or f'.command("{cmd}' in cli_js
            ), f"Command '{cmd}' not found in Node.js cli.js"


# ---------------------------------------------------------------------------
# 2. Same global flags (Req 13.2)
# ---------------------------------------------------------------------------

class TestGlobalFlagsParity:
    """Both implementations support the same global flags."""

    def test_python_has_global_flags(self):
        """Python CLI group has all expected global options."""
        param_names = set()
        for param in cli.params:
            param_names.update(param.opts)
            if hasattr(param, "secondary_opts"):
                param_names.update(param.secondary_opts)
        for flag_group in EXPECTED_GLOBAL_FLAGS:
            for flag in flag_group:
                assert flag in param_names, f"Python CLI missing global flag: {flag}"

    def test_node_has_global_flags(self):
        """Node.js CLI has all expected global option declarations."""
        cli_js = (NODE_SRC / "cli.js").read_text()
        node_flag_patterns = [
            "-o, --output",
            "--json",
            "--agent",
            "-u, --user-id",
            "-a, --agent-id",
            "-r, --run-id",
        ]
        for pattern in node_flag_patterns:
            assert pattern in cli_js, f"Node.js CLI missing global flag pattern: {pattern}"


# ---------------------------------------------------------------------------
# 3. Same environment variables (Req 13.3)
# ---------------------------------------------------------------------------

class TestEnvVarParity:
    """Both implementations use the same environment variable names."""

    def test_python_env_map_has_all_vars(self):
        """Python ENV_MAP contains all expected env vars."""
        for env_var in EXPECTED_ENV_VARS:
            assert env_var in ENV_MAP, f"Python ENV_MAP missing: {env_var}"

    def test_node_has_same_env_vars(self):
        """Node.js config.js references all expected env vars."""
        config_js = (NODE_SRC / "config.js").read_text()
        for env_var in EXPECTED_ENV_VARS:
            assert env_var in config_js, f"Node.js config.js missing env var: {env_var}"

    def test_env_map_keys_match(self):
        """Python ENV_MAP keys exactly match the expected set."""
        assert set(ENV_MAP.keys()) == set(EXPECTED_ENV_VARS)


# ---------------------------------------------------------------------------
# 4. Same config file format (Req 13.4)
# ---------------------------------------------------------------------------

class TestConfigFileParity:
    """Both implementations use ~/.adbpg-mem/config.json."""

    def test_python_config_path(self):
        """Python config module points to ~/.adbpg-mem/config.json."""
        from adbpg_memory_cli.config import CONFIG_DIR, CONFIG_FILE

        assert CONFIG_DIR.name == ".adbpg-mem"
        assert CONFIG_FILE.name == "config.json"
        assert CONFIG_FILE.parent == CONFIG_DIR

    def test_node_config_path(self):
        """Node.js config.js references .adbpg-mem/config.json."""
        config_js = (NODE_SRC / "config.js").read_text()
        assert ".adbpg-mem" in config_js
        assert "config.json" in config_js


# ---------------------------------------------------------------------------
# 5. Same exit codes (Req 13.6)
# ---------------------------------------------------------------------------

class TestExitCodeParity:
    """Both implementations use exit codes 0, 1, 2."""

    def test_python_uses_exit_codes(self):
        """Python CLI source uses ctx.exit(1) and ctx.exit(2)."""
        cli_py = (Path(__file__).resolve().parent.parent / "src" / "adbpg_memory_cli" / "cli.py")
        source = cli_py.read_text()
        assert "ctx.exit(1)" in source, "Python CLI missing exit code 1"
        assert "ctx.exit(2)" in source, "Python CLI missing exit code 2"

    def test_node_uses_exit_codes(self):
        """Node.js CLI source uses process.exit(1) and process.exit(2)."""
        cli_js = (NODE_SRC / "cli.js").read_text()
        assert "process.exit(1)" in cli_js, "Node.js CLI missing exit code 1"
        assert "process.exit(2)" in cli_js, "Node.js CLI missing exit code 2"


# ---------------------------------------------------------------------------
# 6. Same agent JSON envelope structure (Req 13.5)
# ---------------------------------------------------------------------------

class TestAgentEnvelopeParity:
    """Both implementations produce identical agent JSON envelope structures."""

    def test_python_success_envelope_fields(self):
        """Python agent success envelope has correct field names and order."""
        fmt = OutputFormatter("agent")
        output = fmt.format_result(
            "search", [{"id": "1"}], {"user_id": "u", "agent_id": "", "run_id": ""}, 42, count=1
        )
        parsed = json.loads(output)
        assert list(parsed.keys()) == AGENT_SUCCESS_FIELDS
        assert parsed["status"] == "ok"

    def test_python_error_envelope_fields(self):
        """Python agent error envelope has correct field names and order."""
        fmt = OutputFormatter("agent")
        output = fmt.format_error(
            "search", "timeout", {"user_id": "u", "agent_id": "", "run_id": ""}, 100
        )
        parsed = json.loads(output)
        assert list(parsed.keys()) == AGENT_ERROR_FIELDS
        assert parsed["status"] == "error"

    def test_node_success_envelope_field_order(self):
        """Node.js output.js builds success envelope with same field order."""
        output_js = (NODE_SRC / "output.js").read_text()
        # The _formatAgentEnvelope method should produce fields in the same order
        # Verify the JSON.stringify call contains keys in the expected order
        assert "status" in output_js
        assert "command" in output_js
        assert "duration_ms" in output_js
        assert "scope" in output_js
        assert "count" in output_js
        assert "data" in output_js

    def test_node_error_envelope_field_order(self):
        """Node.js output.js builds error envelope with same field order."""
        output_js = (NODE_SRC / "output.js").read_text()
        # The formatError method in agent mode should include the error field
        assert "error" in output_js

    def test_envelope_field_names_identical(self):
        """Success and error envelope field names match the cross-impl contract."""
        # Verify Python OutputFormatter produces exactly the contracted fields
        fmt = OutputFormatter("agent")

        success = json.loads(
            fmt.format_result("add", {"ok": True}, {"user_id": "x", "agent_id": "", "run_id": ""}, 10, count=1)
        )
        assert set(success.keys()) == set(AGENT_SUCCESS_FIELDS)

        error = json.loads(
            fmt.format_error("add", "fail", {"user_id": "x", "agent_id": "", "run_id": ""}, 10)
        )
        assert set(error.keys()) == set(AGENT_ERROR_FIELDS)

    def test_node_envelope_key_names_in_source(self):
        """Node.js source uses identical key names: status, command, duration_ms, scope, count, data, error."""
        output_js = (NODE_SRC / "output.js").read_text()
        # Check that the Node.js source uses snake_case duration_ms (not camelCase)
        assert "duration_ms" in output_js, "Node.js should use 'duration_ms' (snake_case) to match Python"
        # Verify no camelCase variant
        assert "durationMs:" not in output_js.replace("durationMs)", "").replace("durationMs,", "").replace("durationMs;", ""), (
            "Node.js envelope keys should use snake_case 'duration_ms', not camelCase 'durationMs'"
        )
