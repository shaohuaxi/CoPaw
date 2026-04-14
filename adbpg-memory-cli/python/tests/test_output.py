"""Unit tests for adbpg_memory_cli.output module."""

import json

import pytest

from adbpg_memory_cli.output import OutputFormatter, truncate_content


class TestTruncateContent:
    def test_short_text_unchanged(self):
        assert truncate_content("hello") == "hello"

    def test_exact_max_length_unchanged(self):
        text = "a" * 80
        assert truncate_content(text) == text

    def test_over_max_length_truncated(self):
        text = "a" * 100
        result = truncate_content(text)
        assert result == "a" * 80 + "..."

    def test_custom_max_length(self):
        result = truncate_content("abcdefgh", max_length=5)
        assert result == "abcde..."

    def test_empty_string(self):
        assert truncate_content("") == ""


class TestOutputFormatterInit:
    def test_valid_modes(self):
        for mode in ("text", "json", "table", "quiet", "agent"):
            fmt = OutputFormatter(mode)
            assert fmt.mode == mode

    def test_invalid_mode_raises(self):
        with pytest.raises(ValueError, match="Invalid output mode"):
            OutputFormatter("xml")

    def test_default_mode_is_text(self):
        fmt = OutputFormatter()
        assert fmt.mode == "text"


class TestIsMachine:
    @pytest.mark.parametrize("mode,expected", [
        ("text", False),
        ("table", False),
        ("json", True),
        ("agent", True),
        ("quiet", True),
    ])
    def test_is_machine(self, mode, expected):
        fmt = OutputFormatter(mode)
        assert fmt.is_machine is expected


class TestFormatResultAgent:
    def setup_method(self):
        self.fmt = OutputFormatter("agent")
        self.scope = {"user_id": "alice", "agent_id": "", "run_id": ""}

    def test_agent_envelope_structure(self):
        result = self.fmt.format_result("search", [{"id": "1"}], self.scope, 42, 1)
        parsed = json.loads(result)
        assert parsed["status"] == "ok"
        assert parsed["command"] == "search"
        assert parsed["duration_ms"] == 42
        assert parsed["scope"] == self.scope
        assert parsed["count"] == 1
        assert parsed["data"] == [{"id": "1"}]

    def test_agent_envelope_null_count(self):
        result = self.fmt.format_result("add", {"id": "x"}, self.scope, 10)
        parsed = json.loads(result)
        assert parsed["count"] is None


class TestFormatResultJson:
    def test_json_mode_raw_data(self):
        fmt = OutputFormatter("json")
        result = fmt.format_result("list", [1, 2, 3], {}, 0)
        assert json.loads(result) == [1, 2, 3]

    def test_json_mode_unicode(self):
        fmt = OutputFormatter("json")
        result = fmt.format_result("search", {"memory": "你好"}, {}, 0)
        assert "你好" in result


class TestFormatResultQuiet:
    def test_quiet_with_count(self):
        fmt = OutputFormatter("quiet")
        result = fmt.format_result("delete", None, {}, 0, count=5)
        assert result == "5"

    def test_quiet_list_ids(self):
        fmt = OutputFormatter("quiet")
        data = [{"id": "a1"}, {"id": "b2"}]
        result = fmt.format_result("list", data, {}, 0)
        assert result == "a1\nb2"

    def test_quiet_scalar(self):
        fmt = OutputFormatter("quiet")
        result = fmt.format_result("add", "done", {}, 0)
        assert result == "done"


class TestFormatResultTable:
    def test_table_with_dict_list(self):
        fmt = OutputFormatter("table")
        data = [{"id": "1", "memory": "hello"}, {"id": "2", "memory": "world"}]
        result = fmt.format_result("list", data, {}, 0)
        lines = result.split("\n")
        assert "id" in lines[0]
        assert "memory" in lines[0]
        assert len(lines) == 4  # header + separator + 2 rows

    def test_table_empty_list(self):
        fmt = OutputFormatter("table")
        result = fmt.format_result("list", [], {}, 0)
        assert result == "[]"


class TestFormatResultText:
    def test_text_list(self):
        fmt = OutputFormatter("text")
        result = fmt.format_result("list", ["a", "b", "c"], {}, 0)
        assert result == "a\nb\nc"

    def test_text_scalar(self):
        fmt = OutputFormatter("text")
        result = fmt.format_result("add", "Memory added", {}, 0)
        assert result == "Memory added"


class TestFormatError:
    def test_agent_error_envelope(self):
        fmt = OutputFormatter("agent")
        scope = {"user_id": "alice"}
        result = fmt.format_error("search", "Connection timed out", scope, 5023)
        parsed = json.loads(result)
        assert parsed["status"] == "error"
        assert parsed["command"] == "search"
        assert parsed["duration_ms"] == 5023
        assert parsed["scope"] == scope
        assert parsed["count"] == 0
        assert parsed["data"] is None
        assert parsed["error"] == "Connection timed out"

    def test_json_error(self):
        fmt = OutputFormatter("json")
        result = fmt.format_error("add", "fail", {}, 0)
        parsed = json.loads(result)
        assert parsed == {"error": "fail"}

    def test_text_error(self):
        fmt = OutputFormatter("text")
        result = fmt.format_error("add", "something broke", {}, 0)
        assert result == "Error: something broke"

    def test_table_error(self):
        fmt = OutputFormatter("table")
        result = fmt.format_error("list", "oops", {}, 0)
        assert result == "Error: oops"

    def test_quiet_error(self):
        fmt = OutputFormatter("quiet")
        result = fmt.format_error("delete", "denied", {}, 0)
        assert result == "Error: denied"
