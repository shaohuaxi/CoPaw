"""Property-based tests for adbpg_memory_cli.output module.

Uses hypothesis to verify universal properties across random inputs.
"""

import json
import re

import hypothesis.strategies as st
from hypothesis import given, settings, assume

from adbpg_memory_cli.output import OutputFormatter, truncate_content, VALID_MODES


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_safe_text = st.text(
    min_size=0,
    max_size=300,
    alphabet=st.characters(
        whitelist_categories=("L", "N", "P", "S", "Z"),
        blacklist_characters=("\x00",),
    ),
)

_nonempty_safe_text = st.text(
    min_size=1,
    max_size=100,
    alphabet=st.characters(
        whitelist_categories=("L", "N", "P", "S", "Z"),
        blacklist_characters=("\x00",),
    ),
)

# Strategy for generating JSON-serialisable data (dicts, lists, strings, ints, floats, bools, None)
_json_data = st.recursive(
    st.one_of(
        st.none(),
        st.booleans(),
        st.integers(min_value=-10_000, max_value=10_000),
        st.floats(allow_nan=False, allow_infinity=False, min_value=-1e6, max_value=1e6),
        _nonempty_safe_text,
    ),
    lambda children: st.one_of(
        st.lists(children, max_size=5),
        st.dictionaries(
            st.text(min_size=1, max_size=20, alphabet=st.characters(whitelist_categories=("L", "N"))),
            children,
            max_size=5,
        ),
    ),
    max_leaves=15,
)


# ANSI escape code pattern
_ANSI_RE = re.compile(r"\x1b\[")


# ---------------------------------------------------------------------------
# Property 6: 内容摘要截断
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 6: 内容摘要截断
class TestContentTruncation:
    @given(text=_safe_text)
    @settings(max_examples=100)
    def test_truncated_length_within_limit(self, text):
        """**Validates: Requirements 5.3**

        For any string, truncate_content(text, max_length=80) result length
        (not counting the '...' suffix) should not exceed 80 characters.
        If original string length <= 80, result should equal original.
        """
        result = truncate_content(text, max_length=80)

        if len(text) <= 80:
            assert result == text
        else:
            # The truncated portion (before '...') is at most 80 chars
            assert result.endswith("...")
            assert len(result) - len("...") <= 80


# ---------------------------------------------------------------------------
# Property 8: 输出格式标志验证
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 8: 输出格式标志验证
class TestOutputModeValidation:
    @given(mode=st.text(min_size=0, max_size=50))
    @settings(max_examples=100)
    def test_invalid_mode_raises_value_error(self, mode):
        """**Validates: Requirements 7.1**

        For any string NOT in {"text", "json", "table", "quiet", "agent"},
        OutputFormatter(mode) should raise ValueError.
        """
        assume(mode not in VALID_MODES)
        try:
            OutputFormatter(mode)
            assert False, f"Expected ValueError for mode={mode!r}"
        except ValueError:
            pass  # expected


# ---------------------------------------------------------------------------
# Property 9: JSON 输出有效性
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 9: JSON 输出有效性
class TestJsonOutputValidity:
    @given(
        data=_json_data,
        command=_nonempty_safe_text,
        duration_ms=st.integers(min_value=0, max_value=100_000),
    )
    @settings(max_examples=100)
    def test_json_mode_produces_valid_json_without_ansi(self, data, command, duration_ms):
        """**Validates: Requirements 7.3**

        For any command result, when output mode is "json", the output should
        be valid JSON (json.loads() doesn't raise) and should not contain
        ANSI color codes.
        """
        fmt = OutputFormatter("json")
        scope = {"user_id": "test", "agent_id": "", "run_id": ""}
        output = fmt.format_result(command, data, scope, duration_ms)

        # Must be valid JSON
        parsed = json.loads(output)

        # Must not contain ANSI escape codes
        assert not _ANSI_RE.search(output), f"ANSI codes found in JSON output: {output!r}"


# ---------------------------------------------------------------------------
# Property 10: Agent 信封完整性
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 10: Agent 信封完整性
class TestAgentEnvelopeIntegrity:
    @given(
        data=_json_data,
        command=_nonempty_safe_text,
        duration_ms=st.integers(min_value=0, max_value=100_000),
        count=st.one_of(st.none(), st.integers(min_value=0, max_value=10_000)),
        user_id=_nonempty_safe_text,
    )
    @settings(max_examples=100)
    def test_agent_envelope_has_required_fields(self, data, command, duration_ms, count, user_id):
        """**Validates: Requirements 7.6**

        For any command result, when output mode is "agent", the output should
        be valid JSON with required fields: status (ok or error), command (string),
        duration_ms (non-negative int), scope (object), count (non-negative int
        or null), data.
        """
        fmt = OutputFormatter("agent")
        scope = {"user_id": user_id, "agent_id": "", "run_id": ""}
        output = fmt.format_result(command, data, scope, duration_ms, count=count)

        parsed = json.loads(output)

        # Required fields exist
        assert "status" in parsed
        assert "command" in parsed
        assert "duration_ms" in parsed
        assert "scope" in parsed
        assert "count" in parsed
        assert "data" in parsed

        # Field type/value constraints
        assert parsed["status"] in ("ok", "error")
        assert isinstance(parsed["command"], str)
        assert isinstance(parsed["duration_ms"], int) and parsed["duration_ms"] >= 0
        assert isinstance(parsed["scope"], dict)
        assert parsed["count"] is None or (isinstance(parsed["count"], int) and parsed["count"] >= 0)


# ---------------------------------------------------------------------------
# Property 11: 机器模式抑制交互
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 11: 机器模式抑制交互
class TestMachineModeFlag:
    @given(mode=st.sampled_from(list(VALID_MODES)))
    @settings(max_examples=100)
    def test_is_machine_correct_for_mode(self, mode):
        """**Validates: Requirements 7.9**

        For any output mode, is_machine should be True for json/agent/quiet
        and False for text/table.
        """
        fmt = OutputFormatter(mode)
        if mode in ("json", "agent", "quiet"):
            assert fmt.is_machine is True, f"Expected is_machine=True for mode={mode!r}"
        else:
            assert fmt.is_machine is False, f"Expected is_machine=False for mode={mode!r}"
