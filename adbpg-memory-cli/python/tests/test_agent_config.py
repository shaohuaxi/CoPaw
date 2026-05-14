"""Unit tests for adbpg_memory_cli.agent_config module and CLI integration."""

import json
import os
import stat
from pathlib import Path
from unittest.mock import patch

import pytest
from click.testing import CliRunner

from adbpg_memory_cli.agent_config import (
    AGENTS_DIR,
    DEFAULTS,
    VALID_RUN_MODES,
    AgentConfigError,
    get_agent_config,
    set_agent_config,
    show_agent_config,
    unset_agent_config,
    validate_agent_id,
    validate_key,
)
from adbpg_memory_cli.cli import cli


# ---------------------------------------------------------------------------
# Pure-module tests
# ---------------------------------------------------------------------------

class TestValidateAgentId:
    def test_accepts_alphanumeric(self):
        assert validate_agent_id("abc123") == "abc123"

    def test_accepts_underscore_and_dash(self):
        assert validate_agent_id("a_b-c_1-2") == "a_b-c_1-2"

    def test_accepts_max_length_64(self):
        agent_id = "a" * 64
        assert validate_agent_id(agent_id) == agent_id

    def test_rejects_length_65(self):
        with pytest.raises(AgentConfigError, match="invalid agent_id format"):
            validate_agent_id("a" * 65)

    def test_rejects_empty_string(self):
        with pytest.raises(AgentConfigError, match="agent-config commands require"):
            validate_agent_id("")

    def test_rejects_none(self):
        with pytest.raises(AgentConfigError, match="agent-config commands require"):
            validate_agent_id(None)

    def test_rejects_special_characters(self):
        for bad in ("a b", "a.b", "a/b", "a$b", "a@b", "中文"):
            with pytest.raises(AgentConfigError, match="invalid agent_id format"):
                validate_agent_id(bad)


class TestValidateKey:
    def test_accepts_known_keys(self):
        for k in ("isolation_agent", "isolation_run_mode", "current_run_id"):
            assert validate_key(k) == k

    def test_rejects_unknown_key(self):
        with pytest.raises(AgentConfigError, match="unknown key"):
            validate_key("nope")


class TestSetAgentConfig:
    def test_set_isolation_agent_true(self, tmp_path, monkeypatch):
        monkeypatch.setattr("adbpg_memory_cli.agent_config.AGENTS_DIR", tmp_path)
        result = set_agent_config("alice", "isolation_agent", "true", agents_dir=tmp_path)
        assert result is True
        path = tmp_path / "alice.json"
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["isolation_agent"] is True

    def test_set_isolation_agent_accepts_bool(self, tmp_path):
        result = set_agent_config("alice", "isolation_agent", False, agents_dir=tmp_path)
        assert result is False

    def test_set_isolation_agent_rejects_garbage(self, tmp_path):
        with pytest.raises(AgentConfigError, match="invalid value for isolation_agent"):
            set_agent_config("alice", "isolation_agent", "maybe", agents_dir=tmp_path)

    @pytest.mark.parametrize("value", ["1", "0", "yes", "no", "Yes", "NO"])
    def test_set_isolation_agent_rejects_non_boolean_strings(self, tmp_path, value):
        """Cross-impl parity with Node: only 'true'/'false' are accepted."""
        with pytest.raises(AgentConfigError) as exc_info:
            set_agent_config("alice", "isolation_agent", value, agents_dir=tmp_path)
        # Exact error text is part of the cross-impl contract.
        assert str(exc_info.value) == (
            f"invalid value for isolation_agent: expected 'true' or 'false', got '{value}'"
        )

    @pytest.mark.parametrize("value,expected", [
        ("true", True), ("false", False),
        ("TRUE", True), ("False", False), ("True", True), ("FALSE", False),
    ])
    def test_set_isolation_agent_accepts_case_insensitive_true_false(
        self, tmp_path, value, expected
    ):
        result = set_agent_config("alice", "isolation_agent", value, agents_dir=tmp_path)
        assert result is expected

    def test_set_isolation_agent_rejects_surrounding_whitespace(self, tmp_path):
        with pytest.raises(AgentConfigError, match="invalid value for isolation_agent"):
            set_agent_config("alice", "isolation_agent", "  true  ", agents_dir=tmp_path)

    def test_set_isolation_run_mode_valid(self, tmp_path):
        for mode in VALID_RUN_MODES:
            result = set_agent_config("alice", "isolation_run_mode", mode, agents_dir=tmp_path)
            assert result == mode

    def test_set_isolation_run_mode_invalid(self, tmp_path):
        with pytest.raises(AgentConfigError, match="invalid value for isolation_run_mode"):
            set_agent_config("alice", "isolation_run_mode", "rocket", agents_dir=tmp_path)

    def test_set_current_run_id(self, tmp_path):
        result = set_agent_config("alice", "current_run_id", "项目-重构", agents_dir=tmp_path)
        assert result == "项目-重构"

    def test_set_current_run_id_rejects_empty(self, tmp_path):
        with pytest.raises(AgentConfigError, match="must be non-empty"):
            set_agent_config("alice", "current_run_id", "", agents_dir=tmp_path)

    def test_set_unknown_key_rejected(self, tmp_path):
        with pytest.raises(AgentConfigError, match="unknown key"):
            set_agent_config("alice", "bogus", "x", agents_dir=tmp_path)

    def test_set_invalid_agent_id_rejected(self, tmp_path):
        with pytest.raises(AgentConfigError, match="invalid agent_id format"):
            set_agent_config("bad id", "isolation_agent", "true", agents_dir=tmp_path)

    def test_creates_agents_dir(self, tmp_path):
        nested = tmp_path / "nested" / "agents"
        set_agent_config("alice", "isolation_agent", "true", agents_dir=nested)
        assert nested.exists()
        assert (nested / "alice.json").exists()

    @pytest.mark.skipif(os.name == "nt", reason="POSIX permission check")
    def test_file_mode_is_0600(self, tmp_path):
        set_agent_config("alice", "isolation_agent", "true", agents_dir=tmp_path)
        path = tmp_path / "alice.json"
        mode = stat.S_IMODE(path.stat().st_mode)
        assert mode == 0o600

    def test_multiple_set_calls_merge(self, tmp_path):
        set_agent_config("alice", "isolation_agent", "true", agents_dir=tmp_path)
        set_agent_config("alice", "isolation_run_mode", "manual", agents_dir=tmp_path)
        data = json.loads((tmp_path / "alice.json").read_text())
        assert data["isolation_agent"] is True
        assert data["isolation_run_mode"] == "manual"


class TestGetAgentConfig:
    def test_returns_default_when_unset(self, tmp_path):
        assert get_agent_config("ghost", "isolation_agent", agents_dir=tmp_path) is False
        assert get_agent_config("ghost", "isolation_run_mode", agents_dir=tmp_path) == "off"

    def test_returns_none_when_no_default(self, tmp_path):
        assert get_agent_config("ghost", "current_run_id", agents_dir=tmp_path) is None

    def test_returns_stored_value(self, tmp_path):
        set_agent_config("alice", "isolation_run_mode", "auto", agents_dir=tmp_path)
        assert get_agent_config("alice", "isolation_run_mode", agents_dir=tmp_path) == "auto"


class TestShowAgentConfig:
    def test_returns_defaults_when_no_file(self, tmp_path):
        result = show_agent_config("ghost", agents_dir=tmp_path)
        assert result == {"isolation_agent": False, "isolation_run_mode": "off"}
        assert "current_run_id" not in result

    def test_includes_overrides(self, tmp_path):
        set_agent_config("alice", "isolation_agent", "true", agents_dir=tmp_path)
        set_agent_config("alice", "current_run_id", "run-1", agents_dir=tmp_path)
        result = show_agent_config("alice", agents_dir=tmp_path)
        assert result == {
            "isolation_agent": True,
            "isolation_run_mode": "off",
            "current_run_id": "run-1",
        }


class TestUnsetAgentConfig:
    def test_unset_existing_key(self, tmp_path):
        set_agent_config("alice", "isolation_agent", "true", agents_dir=tmp_path)
        unset_agent_config("alice", "isolation_agent", agents_dir=tmp_path)
        data = json.loads((tmp_path / "alice.json").read_text())
        assert "isolation_agent" not in data

    def test_unset_missing_key_is_idempotent(self, tmp_path):
        set_agent_config("alice", "isolation_run_mode", "manual", agents_dir=tmp_path)
        # Should not raise
        unset_agent_config("alice", "isolation_agent", agents_dir=tmp_path)

    def test_unset_when_file_missing_is_idempotent(self, tmp_path):
        unset_agent_config("ghost", "isolation_agent", agents_dir=tmp_path)
        assert not (tmp_path / "ghost.json").exists()


# ---------------------------------------------------------------------------
# CLI integration tests
# ---------------------------------------------------------------------------

@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def patched_agents_dir(tmp_path, monkeypatch):
    """Redirect ~/.adbpg-mem/agents/ to a temporary directory for each test."""
    monkeypatch.setattr(
        "adbpg_memory_cli.agent_config.AGENTS_DIR", tmp_path
    )
    return tmp_path


class TestCliAgentConfigSet:
    def test_set_writes_file(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["-a", "alice", "agent-config", "set", "isolation_agent", "true"],
        )
        assert result.exit_code == 0, result.output
        path = patched_agents_dir / "alice.json"
        assert path.exists()
        data = json.loads(path.read_text())
        assert data["isolation_agent"] is True

    def test_set_agent_envelope(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "set",
             "isolation_run_mode", "manual"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-set"
        assert envelope["agent_id"] == "alice"
        assert envelope["data"] == {"key": "isolation_run_mode", "value": "manual"}
        assert "duration_ms" in envelope
        # Per spec the success envelope omits scope/count
        assert "scope" not in envelope
        assert "count" not in envelope

    def test_set_missing_agent_id_errors(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "agent-config", "set", "isolation_agent", "true"],
        )
        assert result.exit_code == 2
        envelope = json.loads(result.output)
        assert envelope["status"] == "error"
        assert envelope["command"] == "agent-config-set"
        assert envelope["error"] == "agent-config commands require -a <agent_id>"
        assert envelope["data"] is None

    def test_set_invalid_agent_id_errors(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "bad id!", "agent-config", "set",
             "isolation_agent", "true"],
        )
        assert result.exit_code == 2
        envelope = json.loads(result.output)
        assert envelope["status"] == "error"
        assert "invalid agent_id format" in envelope["error"]

    def test_set_invalid_key_errors(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "set", "bogus", "value"],
        )
        assert result.exit_code == 2
        envelope = json.loads(result.output)
        assert envelope["status"] == "error"
        assert "unknown key" in envelope["error"]

    def test_set_invalid_value_errors(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "set",
             "isolation_run_mode", "rocket"],
        )
        assert result.exit_code == 2
        envelope = json.loads(result.output)
        assert envelope["status"] == "error"
        assert "invalid value for isolation_run_mode" in envelope["error"]


class TestCliAgentConfigGet:
    def test_get_returns_default_for_unset(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "ghost", "agent-config", "get", "isolation_agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["agent_id"] == "ghost"
        assert envelope["data"] == {"key": "isolation_agent", "value": False}

    def test_get_returns_stored_value(self, runner, patched_agents_dir):
        runner.invoke(cli, ["-a", "alice", "agent-config", "set",
                             "current_run_id", "项目-重构"])
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "get", "current_run_id"],
        )
        envelope = json.loads(result.output)
        assert envelope["data"] == {"key": "current_run_id", "value": "项目-重构"}


class TestCliAgentConfigShow:
    def test_show_unknown_agent_returns_defaults(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "ghost", "agent-config", "show"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["agent_id"] == "ghost"
        assert envelope["data"] == {"isolation_agent": False, "isolation_run_mode": "off"}
        assert "current_run_id" not in envelope["data"]

    def test_show_includes_overrides(self, runner, patched_agents_dir):
        runner.invoke(cli, ["-a", "alice", "agent-config", "set",
                             "isolation_agent", "true"])
        runner.invoke(cli, ["-a", "alice", "agent-config", "set",
                             "isolation_run_mode", "manual"])
        runner.invoke(cli, ["-a", "alice", "agent-config", "set",
                             "current_run_id", "run-1"])
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "show"],
        )
        envelope = json.loads(result.output)
        assert envelope["data"] == {
            "isolation_agent": True,
            "isolation_run_mode": "manual",
            "current_run_id": "run-1",
        }

    def test_show_text_mode(self, runner, patched_agents_dir):
        result = runner.invoke(cli, ["-a", "alice", "agent-config", "show"])
        assert result.exit_code == 0, result.output
        assert "alice" in result.output
        assert "isolation_agent" in result.output


class TestCliAgentConfigUnset:
    def test_unset_existing_key(self, runner, patched_agents_dir):
        runner.invoke(cli, ["-a", "alice", "agent-config", "set",
                             "isolation_agent", "true"])
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "unset", "isolation_agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        # After unset, get should fall back to default
        get_result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "get", "isolation_agent"],
        )
        assert json.loads(get_result.output)["data"]["value"] is False

    def test_unset_missing_key_is_idempotent(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "unset", "isolation_agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"


# ---------------------------------------------------------------------------
# -a / --agent-id position handling (Bug-1 regression coverage)
# ---------------------------------------------------------------------------

# Spec / SKILL.md teach the LLM agent to call:
#     adbpg-mem agent-config set isolation_agent true -a agent1 --agent
# i.e. -a sits AFTER the subcommand. The Node impl (commander) accepts -a in
# any position; click is stricter, so -a is registered both at the root and on
# each agent-config sub-command. These tests lock in that all positions work
# for all four sub-commands and that subcommand-level -a wins on conflict.


def _arg_combinations(sub_args_no_agent):
    """Yield (label, full_argv) for the three documented -a positions."""
    return [
        ("root_before_group", ["--agent", "-a", "alice"] + sub_args_no_agent),
        ("group_after",       ["--agent", "agent-config", "-a", "alice"] + sub_args_no_agent[1:]),
        ("subcmd_after",      ["--agent"] + sub_args_no_agent + ["-a", "alice"]),
    ]


class TestCliAgentIdPosition:
    """Bug-1: -a must be accepted before the group, after the group, or after the
    subcommand args — to match Node's commander-style flexibility."""

    @pytest.mark.parametrize("label,argv", _arg_combinations(
        ["agent-config", "set", "isolation_agent", "true"]
    ))
    def test_set_accepts_agent_id_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["agent_id"] == "alice"
        assert envelope["data"] == {"key": "isolation_agent", "value": True}

    @pytest.mark.parametrize("label,argv", _arg_combinations(
        ["agent-config", "get", "isolation_agent"]
    ))
    def test_get_accepts_agent_id_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["agent_id"] == "alice"
        assert envelope["data"] == {"key": "isolation_agent", "value": False}

    @pytest.mark.parametrize("label,argv", _arg_combinations(
        ["agent-config", "show"]
    ))
    def test_show_accepts_agent_id_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["agent_id"] == "alice"
        assert envelope["data"] == {"isolation_agent": False, "isolation_run_mode": "off"}

    @pytest.mark.parametrize("label,argv", _arg_combinations(
        ["agent-config", "unset", "isolation_agent"]
    ))
    def test_unset_accepts_agent_id_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["agent_id"] == "alice"

    def test_subcmd_agent_id_overrides_root(self, runner, patched_agents_dir):
        """When -a is provided at both the root and the subcommand,
        the subcommand-level value wins."""
        result = runner.invoke(
            cli,
            ["--agent", "-a", "rootlose", "agent-config", "set",
             "isolation_agent", "true", "-a", "wins"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["agent_id"] == "wins"
        # Side-effect on disk: file was written for "wins", not "rootlose".
        assert (patched_agents_dir / "wins.json").exists()
        assert not (patched_agents_dir / "rootlose.json").exists()

    def test_subcmd_agent_id_overrides_group(self, runner, patched_agents_dir):
        """When -a is provided at both the group and the subcommand,
        the subcommand-level value wins."""
        result = runner.invoke(
            cli,
            ["--agent", "agent-config", "-a", "grouplose", "set",
             "isolation_agent", "true", "-a", "wins"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["agent_id"] == "wins"

    def test_group_agent_id_overrides_root(self, runner, patched_agents_dir):
        """When -a is provided at both the root and the group (but not the
        subcommand), the group-level value wins."""
        result = runner.invoke(
            cli,
            ["--agent", "-a", "rootlose", "agent-config", "-a", "wins",
             "set", "isolation_agent", "true"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["agent_id"] == "wins"


# ---------------------------------------------------------------------------
# --agent / --json output-mode flag position handling (Bug-3 regression)
# ---------------------------------------------------------------------------

# Spec / SKILL.md teach the LLM agent to call:
#     adbpg-mem agent-config set isolation_agent true -a agent1 --agent
# i.e. --agent (the output-format shortcut) sits AFTER the subcommand args.
# The Node impl (commander) accepts --agent in any position; click is stricter,
# so --agent (and --json) must be registered both at the root, on the
# agent-config group, and on each agent-config sub-command. These tests lock
# in that all positions work for all four sub-commands and that
# subcommand-level wins on conflict.


def _agent_flag_combinations(sub_args_no_flag):
    """Yield (label, full_argv) for the three documented --agent positions.

    All variants pin -a alice in the standard root position so the tests focus
    purely on where --agent sits. The first arg of `sub_args_no_flag` must be
    the literal string "agent-config".
    """
    assert sub_args_no_flag[0] == "agent-config"
    return [
        # Root-level --agent before the group name (the historical/click form).
        ("root_before_group", ["--agent", "-a", "alice"] + sub_args_no_flag),
        # Group-level --agent: after the group name, before the subcommand.
        ("group_after",       ["-a", "alice", "agent-config", "--agent"] + sub_args_no_flag[1:]),
        # Subcommand-level --agent at the very end (the spec form).
        ("subcmd_end",        ["-a", "alice"] + sub_args_no_flag + ["--agent"]),
    ]


class TestCliAgentFlagPosition:
    """Bug-3: --agent (output-mode shortcut) must be accepted at root, group,
    or subcommand position — to match Node's commander-style flexibility and
    the spec form ``agent-config <sub> ... -a <id> --agent``."""

    @pytest.mark.parametrize("label,argv", _agent_flag_combinations(
        ["agent-config", "set", "isolation_agent", "true"]
    ))
    def test_set_accepts_agent_flag_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-set"
        assert envelope["agent_id"] == "alice"
        assert envelope["data"] == {"key": "isolation_agent", "value": True}

    @pytest.mark.parametrize("label,argv", _agent_flag_combinations(
        ["agent-config", "get", "isolation_agent"]
    ))
    def test_get_accepts_agent_flag_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-get"
        assert envelope["agent_id"] == "alice"
        assert envelope["data"] == {"key": "isolation_agent", "value": False}

    @pytest.mark.parametrize("label,argv", _agent_flag_combinations(
        ["agent-config", "show"]
    ))
    def test_show_accepts_agent_flag_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-show"
        assert envelope["agent_id"] == "alice"

    @pytest.mark.parametrize("label,argv", _agent_flag_combinations(
        ["agent-config", "unset", "isolation_agent"]
    ))
    def test_unset_accepts_agent_flag_in_any_position(self, runner, patched_agents_dir, label, argv):
        result = runner.invoke(cli, argv)
        assert result.exit_code == 0, f"position={label}: {result.output}"
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-unset"
        assert envelope["agent_id"] == "alice"

    def test_spec_form_full_combo_set(self, runner, patched_agents_dir):
        """The exact form taught to LLM agents in SKILL.md:
            agent-config set <key> <value> -a <id> --agent
        Both -a and --agent live AFTER the subcommand args."""
        result = runner.invoke(
            cli,
            ["agent-config", "set", "isolation_agent", "true", "-a", "agent_a", "--agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-set"
        assert envelope["agent_id"] == "agent_a"

    def test_spec_form_full_combo_show(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["agent-config", "show", "-a", "agent_a", "--agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-show"
        assert envelope["agent_id"] == "agent_a"

    def test_spec_form_full_combo_get(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["agent-config", "get", "isolation_agent", "-a", "agent_a", "--agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-get"
        assert envelope["agent_id"] == "agent_a"

    def test_spec_form_full_combo_unset(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["agent-config", "unset", "isolation_agent", "-a", "agent_a", "--agent"],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-unset"
        assert envelope["agent_id"] == "agent_a"

    def test_subcmd_agent_flag_overrides_root_text(self, runner, patched_agents_dir):
        """When the root says text mode but the subcommand asks for --agent,
        the subcommand wins and we get the JSON envelope."""
        # Default output is text; --agent appears only at the subcommand level.
        result = runner.invoke(
            cli,
            ["-a", "alice", "agent-config", "show", "--agent"],
        )
        assert result.exit_code == 0, result.output
        # Should be a parseable JSON envelope, not the text-mode summary.
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "agent-config-show"

    def test_json_flag_also_supported_at_subcmd(self, runner, patched_agents_dir):
        """--json is the symmetric output-mode shortcut; same position fix applies."""
        result = runner.invoke(
            cli,
            ["agent-config", "show", "-a", "alice", "--json"],
        )
        assert result.exit_code == 0, result.output
        # In json mode the agent-config emit path writes raw data (not the
        # wrapped agent envelope).
        data = json.loads(result.output)
        assert data == {"isolation_agent": False, "isolation_run_mode": "off"}


# ---------------------------------------------------------------------------
# Boolean strict-parsing CLI parity (Bug-2 regression coverage)
# ---------------------------------------------------------------------------

# Cross-impl contract: only 'true'/'false' (case-insensitive) are accepted for
# isolation_agent. The Node impl rejects 1/0/yes/no with a specific error
# message; the Python impl must match exactly so an LLM agent generating the
# same command on either implementation gets the same outcome.


class TestCliIsolationAgentBooleanStrict:
    @pytest.mark.parametrize("value,expected", [
        ("true", True), ("false", False),
        ("TRUE", True), ("False", False), ("True", True),
    ])
    def test_accepts_true_false_case_insensitive(
        self, runner, patched_agents_dir, value, expected
    ):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "set",
             "isolation_agent", value],
        )
        assert result.exit_code == 0, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["data"]["value"] is expected

    @pytest.mark.parametrize("value", ["1", "0", "yes", "no", "Yes", "NO"])
    def test_rejects_non_boolean_strings_with_node_compatible_error(
        self, runner, patched_agents_dir, value
    ):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "set",
             "isolation_agent", value],
        )
        assert result.exit_code == 2, result.output
        envelope = json.loads(result.output)
        assert envelope["status"] == "error"
        assert envelope["command"] == "agent-config-set"
        # Exact text — this is the cross-impl contract with Node.
        assert envelope["error"] == (
            f"invalid value for isolation_agent: expected 'true' or 'false', got '{value}'"
        )


# ---------------------------------------------------------------------------
# Cross-impl envelope contract
# ---------------------------------------------------------------------------

# Field order per spec: success {status, command, duration_ms, agent_id, data};
# error {status, command, error, data}.

class TestAgentConfigEnvelopeContract:
    def test_success_field_order(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "-a", "alice", "agent-config", "show"],
        )
        envelope = json.loads(result.output)
        assert list(envelope.keys()) == [
            "status", "command", "duration_ms", "agent_id", "data",
        ]

    def test_error_field_order_and_no_extras(self, runner, patched_agents_dir):
        result = runner.invoke(
            cli,
            ["--agent", "agent-config", "show"],  # missing -a
        )
        envelope = json.loads(result.output)
        assert list(envelope.keys()) == ["status", "command", "error", "data"]
        # Spec: error envelope explicitly does NOT include scope/count/duration_ms/agent_id
        for forbidden in ("scope", "count", "duration_ms", "agent_id"):
            assert forbidden not in envelope
