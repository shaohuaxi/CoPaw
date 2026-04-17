"""Unit tests for adbpg_memory_cli.config module."""

import json
import os
from pathlib import Path

import pytest

from adbpg_memory_cli.config import (
    ENV_MAP,
    load_config,
    mask_sensitive,
    merge_config,
    save_config,
    validate_config,
)


class TestLoadConfig:
    def test_returns_empty_dict_when_file_missing(self, tmp_path):
        missing = tmp_path / "nonexistent" / "config.json"
        assert load_config(missing) == {}

    def test_loads_valid_json(self, tmp_path):
        cfg = {"api_mode": "sql", "host": "localhost"}
        path = tmp_path / "config.json"
        path.write_text(json.dumps(cfg), encoding="utf-8")
        assert load_config(path) == cfg


class TestSaveConfig:
    def test_creates_directory_and_file(self, tmp_path):
        path = tmp_path / "sub" / "dir" / "config.json"
        cfg = {"api_mode": "rest", "rest_base_url": "https://example.com"}
        save_config(cfg, path)
        assert path.exists()
        loaded = json.loads(path.read_text(encoding="utf-8"))
        assert loaded == cfg

    def test_overwrites_existing(self, tmp_path):
        path = tmp_path / "config.json"
        save_config({"a": 1}, path)
        save_config({"b": 2}, path)
        assert json.loads(path.read_text(encoding="utf-8")) == {"b": 2}


class TestMergeConfig:
    def test_file_only(self, tmp_path):
        path = tmp_path / "config.json"
        save_config({"api_mode": "sql", "host": "filehost"}, path)
        result = merge_config(config_file=path)
        assert result["host"] == "filehost"

    def test_env_overrides_file(self, tmp_path, monkeypatch):
        path = tmp_path / "config.json"
        save_config({"api_mode": "sql", "host": "filehost"}, path)
        monkeypatch.setenv("ADBPG_MEM_HOST", "envhost")
        result = merge_config(config_file=path)
        assert result["host"] == "envhost"

    def test_cli_overrides_env(self, tmp_path, monkeypatch):
        path = tmp_path / "config.json"
        save_config({"api_mode": "sql", "host": "filehost"}, path)
        monkeypatch.setenv("ADBPG_MEM_HOST", "envhost")
        result = merge_config(config_file=path, host="clihost")
        assert result["host"] == "clihost"

    def test_none_cli_flags_ignored(self, tmp_path):
        path = tmp_path / "config.json"
        save_config({"host": "filehost"}, path)
        result = merge_config(config_file=path, host=None)
        assert result["host"] == "filehost"

    def test_port_env_converted_to_int(self, tmp_path, monkeypatch):
        path = tmp_path / "config.json"
        save_config({}, path)
        monkeypatch.setenv("ADBPG_MEM_PORT", "5433")
        result = merge_config(config_file=path)
        assert result["port"] == 5433
        assert isinstance(result["port"], int)

    def test_all_env_vars_mapped(self, monkeypatch, tmp_path):
        path = tmp_path / "config.json"
        save_config({}, path)
        for env_var, config_key in ENV_MAP.items():
            val = "testval" if config_key != "port" else "9999"
            monkeypatch.setenv(env_var, val)
        result = merge_config(config_file=path)
        for env_var, config_key in ENV_MAP.items():
            assert config_key in result


class TestMaskSensitive:
    def test_masks_password(self):
        cfg = {"password": "supersecret"}
        masked = mask_sensitive(cfg)
        assert masked["password"] == "supe***"

    def test_masks_api_key(self):
        cfg = {"rest_api_key": "sk-abcdef123"}
        masked = mask_sensitive(cfg)
        assert masked["rest_api_key"] == "sk-a***"

    def test_short_value_masked_as_stars(self):
        cfg = {"password": "abc"}
        masked = mask_sensitive(cfg)
        assert masked["password"] == "***"

    def test_exactly_four_chars_masked_as_stars(self):
        cfg = {"password": "abcd"}
        masked = mask_sensitive(cfg)
        assert masked["password"] == "***"

    def test_five_chars_shows_prefix(self):
        cfg = {"password": "abcde"}
        masked = mask_sensitive(cfg)
        assert masked["password"] == "abcd***"

    def test_non_sensitive_fields_unchanged(self):
        cfg = {"host": "localhost", "port": 5432}
        masked = mask_sensitive(cfg)
        assert masked == cfg

    def test_empty_password_unchanged(self):
        cfg = {"password": ""}
        masked = mask_sensitive(cfg)
        assert masked["password"] == ""

    def test_returns_copy(self):
        cfg = {"password": "secret123"}
        masked = mask_sensitive(cfg)
        assert masked is not cfg
        assert cfg["password"] == "secret123"


class TestValidateConfig:
    def test_valid_sql_config(self):
        cfg = {
            "api_mode": "sql",
            "host": "localhost",
            "port": 5432,
            "user": "admin",
            "password": "pass",
            "dbname": "mydb",
        }
        valid, errors = validate_config(cfg)
        assert valid is True
        assert errors == []

    def test_valid_rest_config(self):
        cfg = {
            "api_mode": "rest",
            "rest_base_url": "https://example.com",
            "rest_api_key": "sk-123",
        }
        valid, errors = validate_config(cfg)
        assert valid is True
        assert errors == []

    def test_missing_api_mode(self):
        valid, errors = validate_config({})
        assert valid is False
        assert any("api_mode" in e for e in errors)

    def test_invalid_api_mode(self):
        valid, errors = validate_config({"api_mode": "grpc"})
        assert valid is False
        assert any("sql" in e and "rest" in e for e in errors)

    def test_sql_missing_host(self):
        cfg = {
            "api_mode": "sql",
            "port": 5432,
            "user": "admin",
            "password": "pass",
            "dbname": "mydb",
        }
        valid, errors = validate_config(cfg)
        assert valid is False
        assert any("host" in e for e in errors)

    def test_sql_empty_string_field(self):
        cfg = {
            "api_mode": "sql",
            "host": "",
            "port": 5432,
            "user": "admin",
            "password": "pass",
            "dbname": "mydb",
        }
        valid, errors = validate_config(cfg)
        assert valid is False
        assert any("host" in e for e in errors)

    def test_rest_missing_base_url(self):
        cfg = {"api_mode": "rest", "rest_api_key": "sk-123"}
        valid, errors = validate_config(cfg)
        assert valid is False
        assert any("rest_base_url" in e for e in errors)

    def test_rest_missing_api_key(self):
        cfg = {"api_mode": "rest", "rest_base_url": "https://example.com"}
        valid, errors = validate_config(cfg)
        assert valid is False
        assert any("rest_api_key" in e for e in errors)

    def test_multiple_missing_fields(self):
        cfg = {"api_mode": "sql"}
        valid, errors = validate_config(cfg)
        assert valid is False
        assert len(errors) == 5  # host, port, user, password, dbname
