"""Property-based tests for adbpg_memory_cli.client module.

Uses hypothesis to verify universal properties across random inputs.
"""

import json

import hypothesis.strategies as st
from hypothesis import given, settings, assume

from adbpg_memory_cli.client import text_to_messages, parse_json_messages


# ---------------------------------------------------------------------------
# Property 4: 文本输入转消息列表
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 4: 文本输入转消息列表
class TestTextToMessages:
    @given(text=st.text(min_size=1))
    @settings(max_examples=100)
    def test_non_empty_text_produces_messages_with_original_content(self, text):
        """**Validates: Requirements 3.1, 3.5, 3.6**

        For any non-empty string text, text_to_messages(text) should return
        a list with at least one message, and that message's content field
        should equal the original text.
        """
        messages = text_to_messages(text)
        assert isinstance(messages, list)
        assert len(messages) >= 1
        assert messages[0]["content"] == text


# ---------------------------------------------------------------------------
# Property 5: JSON 输入解析
# ---------------------------------------------------------------------------

# JSON-serializable list strategy: lists of simple dicts/primitives
_json_values = st.recursive(
    st.none() | st.booleans() | st.integers() | st.floats(allow_nan=False, allow_infinity=False) | st.text(max_size=50),
    lambda children: st.lists(children, max_size=5) | st.dictionaries(st.text(max_size=20), children, max_size=5),
    max_leaves=10,
)

_json_lists = st.lists(_json_values, max_size=10)


# Feature: adbpg-memory-cli, Property 5: JSON 输入解析
class TestJsonInputParsing:
    @given(data=_json_lists)
    @settings(max_examples=100)
    def test_valid_json_list_roundtrips(self, data):
        """**Validates: Requirements 3.3, 3.7**

        For any valid JSON-serializable list, json.dumps() then
        parse_json_messages() should return the original list.
        """
        json_str = json.dumps(data)
        result = parse_json_messages(json_str)
        assert result == data

    @given(text=st.text(min_size=1, max_size=200))
    @settings(max_examples=100)
    def test_invalid_json_raises_value_error(self, text):
        """**Validates: Requirements 3.3, 3.7**

        For any invalid JSON string, parse_json_messages() should raise
        ValueError.
        """
        # Ensure the text is not valid JSON that parses to a list
        try:
            parsed = json.loads(text)
            if isinstance(parsed, list):
                assume(False)  # skip: this is actually a valid JSON list
        except (json.JSONDecodeError, ValueError):
            pass  # good — this is truly invalid JSON or non-list

        try:
            parse_json_messages(text)
            # If we get here without error, the input was valid JSON but not a list,
            # which should have raised ValueError("JSON messages must be an array")
            assert False, f"Expected ValueError for input: {text!r}"
        except ValueError:
            pass  # expected
