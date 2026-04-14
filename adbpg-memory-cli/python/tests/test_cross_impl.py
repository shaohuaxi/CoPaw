"""Cross-implementation property tests for ADBPG Memory CLI.

Verifies that the Python OutputFormatter in agent mode produces JSON output
matching the cross-implementation contract shared with the Node.js implementation.

Feature: adbpg-memory-cli, Property 14: 跨实现 Agent JSON 输出一致性
"""

import json

import hypothesis.strategies as st
from hypothesis import given, settings

from adbpg_memory_cli.output import OutputFormatter


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_safe_text = st.text(
    min_size=1,
    max_size=100,
    alphabet=st.characters(
        whitelist_categories=("L", "N", "P", "S", "Z"),
        blacklist_characters=("\x00",),
    ),
)

_command = st.sampled_from(["add", "search", "list", "delete", "config", "status"])

_scope = st.fixed_dictionaries({
    "user_id": _safe_text,
    "agent_id": _safe_text,
    "run_id": _safe_text,
})

_duration_ms = st.integers(min_value=0, max_value=100_000)

_count = st.integers(min_value=0, max_value=10_000)

_json_leaf = st.one_of(
    st.none(),
    st.booleans(),
    st.integers(min_value=-10_000, max_value=10_000),
    st.floats(allow_nan=False, allow_infinity=False, min_value=-1e6, max_value=1e6),
    _safe_text,
)

_json_data = st.recursive(
    _json_leaf,
    lambda children: st.one_of(
        st.lists(children, max_size=5),
        st.dictionaries(
            st.text(min_size=1, max_size=10, alphabet=st.characters(whitelist_categories=("L", "N"))),
            children,
            max_size=5,
        ),
    ),
    max_leaves=10,
)

# Expected field order for success envelope
SUCCESS_FIELDS = ["status", "command", "duration_ms", "scope", "count", "data"]

# Expected field order for error envelope
ERROR_FIELDS = ["status", "command", "duration_ms", "scope", "count", "data", "error"]


# ---------------------------------------------------------------------------
# Property 14: 跨实现 Agent JSON 输出一致性 — Success envelope
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 14: 跨实现 Agent JSON 输出一致性
class TestCrossImplAgentSuccessEnvelope:
    """**Validates: Requirements 1.11, 13.5**"""

    @given(
        command=_command,
        data=_json_data,
        scope=_scope,
        duration_ms=_duration_ms,
        count=_count,
    )
    @settings(max_examples=100)
    def test_success_envelope_field_names_and_order(
        self, command, data, scope, duration_ms, count
    ):
        """Agent success envelope must have exactly the fields
        ["status", "command", "duration_ms", "scope", "count", "data"]
        in that order, matching the cross-implementation contract.
        """
        fmt = OutputFormatter("agent")
        output = fmt.format_result(command, data, scope, duration_ms, count=count)
        parsed = json.loads(output)

        # Field names must match exactly
        assert list(parsed.keys()) == SUCCESS_FIELDS

        # Field types must match the contract
        assert isinstance(parsed["status"], str) and parsed["status"] == "ok"
        assert isinstance(parsed["command"], str)
        assert isinstance(parsed["duration_ms"], int) and parsed["duration_ms"] >= 0
        assert isinstance(parsed["scope"], dict)
        assert isinstance(parsed["count"], int) and parsed["count"] >= 0
        # data can be any JSON-serialisable value — just verify it exists
        assert "data" in parsed


# ---------------------------------------------------------------------------
# Property 14: 跨实现 Agent JSON 输出一致性 — Error envelope
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 14: 跨实现 Agent JSON 输出一致性
class TestCrossImplAgentErrorEnvelope:
    """**Validates: Requirements 1.11, 13.5**"""

    @given(
        command=_command,
        error_msg=_safe_text,
        scope=_scope,
        duration_ms=_duration_ms,
    )
    @settings(max_examples=100)
    def test_error_envelope_field_names_and_order(
        self, command, error_msg, scope, duration_ms
    ):
        """Agent error envelope must have exactly the fields
        ["status", "command", "duration_ms", "scope", "count", "data", "error"]
        in that order, matching the cross-implementation contract.
        """
        fmt = OutputFormatter("agent")
        output = fmt.format_error(command, error_msg, scope, duration_ms)
        parsed = json.loads(output)

        # Field names must match exactly
        assert list(parsed.keys()) == ERROR_FIELDS

        # Field types must match the contract
        assert isinstance(parsed["status"], str) and parsed["status"] == "error"
        assert isinstance(parsed["command"], str)
        assert isinstance(parsed["duration_ms"], int) and parsed["duration_ms"] >= 0
        assert isinstance(parsed["scope"], dict)
        assert isinstance(parsed["count"], int) and parsed["count"] == 0
        assert parsed["data"] is None
        assert isinstance(parsed["error"], str)
