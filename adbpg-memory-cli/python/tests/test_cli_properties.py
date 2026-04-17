"""Property-based tests for adbpg_memory_cli.cli module.

Uses hypothesis to verify universal properties across random inputs.
"""

import json
from unittest.mock import MagicMock, patch

import hypothesis.strategies as st
from hypothesis import given, settings, assume

from click.testing import CliRunner

from adbpg_memory_cli.cli import cli
from adbpg_memory_cli.output import OutputFormatter


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_safe_text = st.text(
    min_size=1,
    max_size=200,
    alphabet=st.characters(
        whitelist_categories=("L", "N", "P", "S"),
        blacklist_characters=("\x00",),
    ),
)

_memory_id = st.text(
    min_size=1,
    max_size=50,
    alphabet=st.characters(whitelist_categories=("L", "N")),
)

_score = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)

_timestamp = st.from_regex(
    r"20[0-9]{2}-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-5][0-9]Z",
    fullmatch=True,
)

_memory_object = st.fixed_dictionaries({
    "id": _memory_id,
    "memory": _safe_text,
    "score": _score,
    "created_at": _timestamp,
})


# ---------------------------------------------------------------------------
# Property 12: 搜索结果显示完整性
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 12: 搜索结果显示完整性
class TestSearchResultCompleteness:
    @given(mem=_memory_object)
    @settings(max_examples=100)
    def test_text_mode_contains_all_fields(self, mem):
        """**Validates: Requirements 4.4**

        For any search result memory object (containing id, memory, score,
        created_at fields), formatted output in "text" mode should contain
        all four field values.
        """
        fmt = OutputFormatter("text")
        scope = {"user_id": "test", "agent_id": "", "run_id": ""}
        output = fmt.format_result("search", [mem], scope, duration_ms=0, count=1)

        # text mode uses str(dict) which repr-escapes string values,
        # so we check against repr() for string fields
        assert str(mem["id"]) in output
        assert repr(mem["memory"]) in output
        assert str(mem["score"]) in output
        assert str(mem["created_at"]) in output

    @given(mem=_memory_object)
    @settings(max_examples=100)
    def test_agent_mode_contains_all_fields(self, mem):
        """**Validates: Requirements 4.4**

        For any search result memory object, formatted output in "agent" mode
        should produce a JSON envelope whose data contains all four fields.
        """
        fmt = OutputFormatter("agent")
        scope = {"user_id": "test", "agent_id": "", "run_id": ""}
        output = fmt.format_result("search", [mem], scope, duration_ms=0, count=1)

        envelope = json.loads(output)
        assert envelope["status"] == "ok"
        assert isinstance(envelope["data"], list)
        assert len(envelope["data"]) == 1

        result_mem = envelope["data"][0]
        assert result_mem["id"] == mem["id"]
        assert result_mem["memory"] == mem["memory"]
        assert result_mem["score"] == mem["score"]
        assert result_mem["created_at"] == mem["created_at"]


# ---------------------------------------------------------------------------
# Property 13: 退出码分类
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 13: 退出码分类
class TestExitCodeClassification:
    @given(
        command_name=st.sampled_from(["search", "list", "status"]),
        user_id=st.text(min_size=1, max_size=20, alphabet=st.characters(whitelist_categories=("L", "N"))),
    )
    @settings(max_examples=100)
    def test_success_returns_exit_code_0(self, command_name, user_id):
        """**Validates: Requirements 13.6**

        For any CLI execution that succeeds, the exit code should be 0.
        """
        runner = CliRunner()
        mock_client = MagicMock()
        mock_client.search.return_value = [{"id": "1", "memory": "m", "score": 0.5, "created_at": "2024-01-01"}]
        mock_client.list_all.return_value = [{"id": "1", "memory": "m", "created_at": "2024-01-01"}]
        mock_client.test_connection.return_value = (True, "OK")

        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": user_id}):
            if command_name == "search":
                result = runner.invoke(cli, ["--agent", "-u", user_id, "search", "query"])
            elif command_name == "list":
                result = runner.invoke(cli, ["--agent", "-u", user_id, "list"])
            else:  # status
                result = runner.invoke(cli, ["--agent", "-u", user_id, "status"])

            assert result.exit_code == 0, f"Expected exit code 0 for successful {command_name}, got {result.exit_code}: {result.output}"

    @given(
        command_name=st.sampled_from(["search", "list", "status"]),
        error_msg=st.text(min_size=1, max_size=100, alphabet=st.characters(whitelist_categories=("L", "N", "P", "S", "Z"), blacklist_characters=("\x00",))),
    )
    @settings(max_examples=100)
    def test_connection_failure_returns_exit_code_1(self, command_name, error_msg):
        """**Validates: Requirements 13.6**

        For any CLI execution that encounters a connection failure or runtime
        error, the exit code should be 1.
        """
        runner = CliRunner()
        mock_client = MagicMock()
        mock_client.search.side_effect = ConnectionError(error_msg)
        mock_client.list_all.side_effect = ConnectionError(error_msg)
        mock_client.test_connection.side_effect = ConnectionError(error_msg)

        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            if command_name == "search":
                result = runner.invoke(cli, ["search", "query"])
            elif command_name == "list":
                result = runner.invoke(cli, ["list"])
            else:  # status
                result = runner.invoke(cli, ["status"])

            assert result.exit_code == 1, f"Expected exit code 1 for connection failure in {command_name}, got {result.exit_code}: {result.output}"

    @given(
        error_scenario=st.sampled_from([
            "no_input",
            "invalid_metadata",
            "invalid_json_messages",
            "init_machine_mode",
        ]),
    )
    @settings(max_examples=100)
    def test_config_error_returns_exit_code_2(self, error_scenario):
        """**Validates: Requirements 13.6**

        For any CLI execution that encounters a configuration error or input
        validation error, the exit code should be 2.
        """
        runner = CliRunner()

        with patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            if error_scenario == "no_input":
                result = runner.invoke(cli, ["add"])
            elif error_scenario == "invalid_metadata":
                result = runner.invoke(cli, ["add", "text", "--metadata", "not-json"])
            elif error_scenario == "invalid_json_messages":
                result = runner.invoke(cli, ["add", "--json-messages", "not-json"])
            else:  # init_machine_mode
                result = runner.invoke(cli, ["--json", "init"])

            assert result.exit_code == 2, f"Expected exit code 2 for {error_scenario}, got {result.exit_code}: {result.output}"
