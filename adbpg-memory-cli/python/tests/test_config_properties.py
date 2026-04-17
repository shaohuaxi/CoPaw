"""Property-based tests for adbpg_memory_cli.config module.

Uses hypothesis to verify universal properties across random inputs.
"""

import json
import os
import tempfile
from pathlib import Path

import hypothesis.strategies as st
import pytest
from hypothesis import given, settings, assume

from adbpg_memory_cli.config import (
    load_config,
    mask_sensitive,
    merge_config,
    save_config,
    validate_config,
)

# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

_safe_alphabet = st.characters(
    whitelist_categories=("L", "N", "P", "S", "Z"),
    blacklist_characters=("\x00",),
)
_alphanum = st.characters(whitelist_categories=("L", "N"))

CONFIG_KEYS = [
    "api_mode", "host", "port", "user", "password", "dbname",
    "rest_api_key", "rest_base_url", "user_id",
    "llm_model", "llm_api_key", "llm_base_url",
    "embedding_model", "embedding_api_key", "embedding_base_url",
    "search_timeout",
]


@st.composite
def config_dicts(draw):
    """Generate a config dict with random values for all config keys."""
    config = {}
    for key in CONFIG_KEYS:
        if key == "port":
            config[key] = draw(st.integers(min_value=1, max_value=65535))
        elif key == "search_timeout":
            config[key] = draw(
                st.floats(min_value=0.1, max_value=300.0,
                           allow_nan=False, allow_infinity=False)
            )
        else:
            config[key] = draw(
                st.text(min_size=1, max_size=50, alphabet=_safe_alphabet)
            )
    return config


# ---------------------------------------------------------------------------
# Property 1: 配置保存/加载往返一致性
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 1: 配置保存/加载往返一致性
class TestConfigRoundTrip:
    @given(config=config_dicts())
    @settings(max_examples=100)
    def test_save_then_load_returns_equivalent_dict(self, config):
        """**Validates: Requirements 2.8, 8.2**

        For any valid config dict, save_config() then load_config()
        should return an equivalent dict.
        """
        with tempfile.TemporaryDirectory() as td:
            config_file = Path(td) / "config.json"
            save_config(config, config_file)
            loaded = load_config(config_file)
            assert loaded == config


# ---------------------------------------------------------------------------
# Property 2: 配置优先级链
# ---------------------------------------------------------------------------

# Feature: adbpg-memory-cli, Property 2: 配置优先级链
class TestConfigPriorityChain:
    @given(
        cli_val=st.text(min_size=1, max_size=30, alphabet=_alphanum),
        env_val=st.text(min_size=1, max_size=30, alphabet=_alphanum),
        file_val=st.text(min_size=1, max_size=30, alphabet=_alphanum),
    )
    @settings(max_examples=100)
    def test_cli_overrides_env_overrides_file(self, cli_val, env_val, file_val):
        """**Validates: Requirements 10.2, 10.3, 3.2, 4.2, 5.2, 6.2, 11.1**

        For the 'host' config key (using ADBPG_MEM_HOST env var):
        - When CLI flag, env var, and config file all provide a value,
          merge_config() result equals CLI flag value.
        - When only env var and config file provide values,
          result equals env var value.
        - When only config file provides value,
          result equals config file value.
        """
        assume(cli_val != env_val and env_val != file_val and cli_val != file_val)

        saved_env = {}
        for key in list(os.environ):
            if key.startswith("ADBPG_MEM_"):
                saved_env[key] = os.environ.pop(key)

        try:
            with tempfile.TemporaryDirectory() as td:
                config_file = Path(td) / "config.json"
                save_config({"host": file_val}, config_file)

                # Case 1: CLI > env > file
                os.environ["ADBPG_MEM_HOST"] = env_val
                result = merge_config(config_file=config_file, host=cli_val)
                assert result["host"] == cli_val

                # Case 2: env > file (no CLI flag)
                result = merge_config(config_file=config_file)
                assert result["host"] == env_val

                # Case 3: file only
                del os.environ["ADBPG_MEM_HOST"]
                result = merge_config(config_file=config_file)
                assert result["host"] == file_val
        finally:
            for key in list(os.environ):
                if key.startswith("ADBPG_MEM_"):
                    del os.environ[key]
            os.environ.update(saved_env)


# ---------------------------------------------------------------------------
# Property 3: 必填字段验证
# ---------------------------------------------------------------------------

SQL_REQUIRED = ["host", "port", "user", "password", "dbname"]
REST_REQUIRED = ["rest_base_url", "rest_api_key"]


def _make_valid_sql_config():
    return {
        "api_mode": "sql",
        "host": "localhost",
        "port": 5432,
        "user": "admin",
        "password": "secret",
        "dbname": "testdb",
    }


def _make_valid_rest_config():
    return {
        "api_mode": "rest",
        "rest_base_url": "https://example.com",
        "rest_api_key": "sk-abc123",
    }


# Feature: adbpg-memory-cli, Property 3: 必填字段验证
class TestRequiredFieldValidation:
    @given(field=st.sampled_from(SQL_REQUIRED))
    @settings(max_examples=100)
    def test_sql_mode_missing_field_fails(self, field):
        """**Validates: Requirements 2.10**

        When api_mode is "sql" and any SQL required field is missing,
        validate_config should return False.
        """
        config = _make_valid_sql_config()
        del config[field]
        valid, errors = validate_config(config)
        assert valid is False
        assert any(field in e for e in errors)

    @given(field=st.sampled_from(SQL_REQUIRED))
    @settings(max_examples=100)
    def test_sql_mode_empty_field_fails(self, field):
        """**Validates: Requirements 2.10**

        When api_mode is "sql" and any SQL required field is empty string,
        validate_config should return False.
        """
        config = _make_valid_sql_config()
        config[field] = ""
        valid, errors = validate_config(config)
        assert valid is False
        assert any(field in e for e in errors)

    @given(field=st.sampled_from(REST_REQUIRED))
    @settings(max_examples=100)
    def test_rest_mode_missing_field_fails(self, field):
        """**Validates: Requirements 2.10**

        When api_mode is "rest" and rest_base_url or rest_api_key is missing,
        validate_config should return False.
        """
        config = _make_valid_rest_config()
        del config[field]
        valid, errors = validate_config(config)
        assert valid is False
        assert any(field in e for e in errors)

    @given(field=st.sampled_from(REST_REQUIRED))
    @settings(max_examples=100)
    def test_rest_mode_empty_field_fails(self, field):
        """**Validates: Requirements 2.10**

        When api_mode is "rest" and rest_base_url or rest_api_key is empty,
        validate_config should return False.
        """
        config = _make_valid_rest_config()
        config[field] = ""
        valid, errors = validate_config(config)
        assert valid is False
        assert any(field in e for e in errors)


# ---------------------------------------------------------------------------
# Property 7: 敏感字段遮蔽
# ---------------------------------------------------------------------------

SENSITIVE_KEYS = ["password", "rest_api_key", "llm_api_key", "embedding_api_key"]


# Feature: adbpg-memory-cli, Property 7: 敏感字段遮蔽
class TestSensitiveFieldMasking:
    @given(
        key=st.sampled_from(SENSITIVE_KEYS),
        value=st.text(
            min_size=1,
            max_size=100,
            alphabet=st.characters(
                whitelist_categories=("L", "N", "P", "S"),
                blacklist_characters=("\x00",),
            ),
        ),
    )
    @settings(max_examples=100)
    def test_mask_sensitive_hides_value(self, key, value):
        """**Validates: Requirements 8.1**

        For any config dict with password/api_key fields containing
        non-empty values, mask_sensitive() should return values that
        don't equal the original and contain '***'.
        """
        # Exclude values that coincidentally equal their own masked form
        assume(value != "***" and not (len(value) > 4 and value == value[:4] + "***"))
        config = {key: value}
        masked = mask_sensitive(config)
        assert masked[key] != value
        assert "***" in masked[key]
