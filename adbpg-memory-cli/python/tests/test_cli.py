"""Unit tests for adbpg_memory_cli.cli module."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import click
import pytest
from click.testing import CliRunner

from adbpg_memory_cli.cli import cli
from adbpg_memory_cli.version import __version__


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def tmp_config(tmp_path):
    """Create a minimal SQL config file and patch CONFIG_FILE to use it."""
    cfg = {
        "api_mode": "sql",
        "host": "localhost",
        "port": 5432,
        "user": "admin",
        "password": "secret",
        "dbname": "testdb",
        "user_id": "testuser",
    }
    path = tmp_path / "config.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    return path


@pytest.fixture
def tmp_rest_config(tmp_path):
    """Create a minimal REST config file."""
    cfg = {
        "api_mode": "rest",
        "rest_base_url": "https://example.com",
        "rest_api_key": "sk-test123",
        "user_id": "restuser",
    }
    path = tmp_path / "config.json"
    path.write_text(json.dumps(cfg), encoding="utf-8")
    return path


def _patch_config_file(config_path):
    """Return a patch context for CONFIG_FILE."""
    return patch("adbpg_memory_cli.cli.load_config", side_effect=lambda cf=None: json.loads(config_path.read_text()))


# ---------------------------------------------------------------------------
# 6.1 Global flags and command group
# ---------------------------------------------------------------------------

class TestGlobalFlags:
    def test_help_shows_all_commands(self, runner):
        result = runner.invoke(cli, ["--help"])
        assert result.exit_code == 0
        for cmd in ("init", "add", "search", "list", "delete", "config", "status", "version"):
            assert cmd in result.output

    def test_version_flag(self, runner):
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert __version__ in result.output

    def test_json_flag_sets_output_mode(self, runner):
        result = runner.invoke(cli, ["--json", "version"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["version"] == __version__

    def test_agent_flag_sets_output_mode(self, runner):
        result = runner.invoke(cli, ["--agent", "version"])
        assert result.exit_code == 0
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["command"] == "version"

    def test_invalid_output_mode_rejected(self, runner):
        result = runner.invoke(cli, ["-o", "xml", "version"])
        assert result.exit_code != 0


# ---------------------------------------------------------------------------
# 6.2 init command
# ---------------------------------------------------------------------------

class TestInitCommand:
    def test_init_interactive_sql(self, runner, tmp_path):
        config_path = tmp_path / "config.json"
        with patch("adbpg_memory_cli.cli.CONFIG_FILE", config_path), \
             patch("adbpg_memory_cli.cli.save_config") as mock_save, \
             patch("adbpg_memory_cli.cli.load_config", return_value={}):
            # Provide all prompts for SQL mode
            inputs = "\n".join([
                "sql",       # api_mode
                "myhost",    # host
                "5432",      # port
                "myuser",    # user
                "mypass",    # password
                "mydb",      # dbname
                "qwen-plus", # llm_model
                "sk-llm",    # llm_api_key
                "https://llm.example.com",  # llm_base_url
                "text-embedding-v3",  # embedding_model
                "sk-emb",    # embedding_api_key
                "https://emb.example.com",  # embedding_base_url
                "1024",      # embedding_dims
                "alice",     # user_id
            ])
            result = runner.invoke(cli, ["init"], input=inputs)
            assert result.exit_code == 0
            assert mock_save.called
            saved = mock_save.call_args[0][0]
            assert saved["api_mode"] == "sql"
            assert saved["host"] == "myhost"
            assert saved["user_id"] == "alice"

    def test_init_interactive_rest(self, runner, tmp_path):
        config_path = tmp_path / "config.json"
        with patch("adbpg_memory_cli.cli.CONFIG_FILE", config_path), \
             patch("adbpg_memory_cli.cli.save_config") as mock_save, \
             patch("adbpg_memory_cli.cli.load_config", return_value={}):
            inputs = "\n".join([
                "rest",
                "https://api.example.com",
                "sk-rest-key",
                "bob",
            ])
            result = runner.invoke(cli, ["init"], input=inputs)
            assert result.exit_code == 0
            saved = mock_save.call_args[0][0]
            assert saved["api_mode"] == "rest"
            assert saved["rest_base_url"] == "https://api.example.com"

    def test_init_machine_mode_errors(self, runner):
        result = runner.invoke(cli, ["--json", "init"])
        assert result.exit_code == 2

    def test_init_agent_mode_errors(self, runner):
        result = runner.invoke(cli, ["--agent", "init"])
        assert result.exit_code == 2

    def test_init_shows_existing_defaults(self, runner, tmp_path):
        existing = {"api_mode": "sql", "host": "oldhost", "port": 5432,
                     "user": "olduser", "password": "oldpass", "dbname": "olddb",
                     "user_id": "olduser_id"}
        config_path = tmp_path / "config.json"
        with patch("adbpg_memory_cli.cli.CONFIG_FILE", config_path), \
             patch("adbpg_memory_cli.cli.save_config") as mock_save, \
             patch("adbpg_memory_cli.cli.load_config", return_value=existing):
            # Provide values for all prompts (defaults shown from existing config)
            inputs = "\n".join([
                "sql",       # api_mode (default sql)
                "oldhost",   # host (accept existing)
                "5432",      # port
                "olduser",   # user
                "oldpass",   # password
                "olddb",     # dbname
                "",          # llm_model (optional, empty ok)
                "",          # llm_api_key (optional)
                "",          # llm_base_url (optional)
                "",          # embedding_model (optional)
                "",          # embedding_api_key (optional)
                "",          # embedding_base_url (optional)
                "1024",      # embedding_dims
                "olduser_id",  # user_id
            ])
            result = runner.invoke(cli, ["init"], input=inputs)
            assert result.exit_code == 0
            assert mock_save.called


# ---------------------------------------------------------------------------
# 6.3 add command
# ---------------------------------------------------------------------------

class TestAddCommand:
    def _make_mock_client(self, return_value=None):
        mock = MagicMock()
        mock.add.return_value = return_value or {"result": "ok", "memories": []}
        return mock

    def test_add_text_directly(self, runner):
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "hello world"])
            assert result.exit_code == 0
            mock_client.add.assert_called_once()
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["messages"] == [{"role": "user", "content": "hello world"}]

    def test_add_from_stdin(self, runner):
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "-"], input="stdin content")
            assert result.exit_code == 0
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["messages"] == [{"role": "user", "content": "stdin content"}]

    def test_add_from_file(self, runner, tmp_path):
        f = tmp_path / "input.txt"
        f.write_text("file content", encoding="utf-8")
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "--file", str(f)])
            assert result.exit_code == 0
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["messages"] == [{"role": "user", "content": "file content"}]

    def test_add_json_messages(self, runner):
        mock_client = self._make_mock_client()
        msgs = [{"role": "user", "content": "hi"}]
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "--json-messages", json.dumps(msgs)])
            assert result.exit_code == 0
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["messages"] == msgs

    def test_add_with_metadata(self, runner):
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "text", "--metadata", '{"key":"val"}'])
            assert result.exit_code == 0
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["metadata"] == {"key": "val"}

    def test_add_with_memory_type(self, runner):
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "text", "--memory-type", "procedural_memory"])
            assert result.exit_code == 0
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["metadata"]["memory_type"] == "procedural_memory"

    def test_add_prompt_sql_mode(self, runner):
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "text", "--prompt", "custom prompt"])
            assert result.exit_code == 0
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["prompt"] == "custom prompt"

    def test_add_prompt_rest_mode_warns(self, runner):
        mock_client = self._make_mock_client()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "rest", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "text", "--prompt", "custom prompt"])
            assert result.exit_code == 0
            # Warning goes to stderr (captured in output when mix_stderr is default)
            full_output = result.output + (getattr(result, "stderr", "") or "")
            assert "Warning" in full_output or "only available in SQL mode" in full_output
            call_kwargs = mock_client.add.call_args
            assert call_kwargs[1]["prompt"] is None

    def test_add_no_input_errors(self, runner):
        with patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add"])
            assert result.exit_code == 2

    def test_add_invalid_metadata_json(self, runner):
        with patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "text", "--metadata", "not-json"])
            assert result.exit_code == 2

    def test_add_invalid_json_messages(self, runner):
        with patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "--json-messages", "not-json"])
            assert result.exit_code == 2

    def test_add_connection_error_exit_1(self, runner):
        mock_client = MagicMock()
        mock_client.add.side_effect = ConnectionError("Connection refused")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["add", "text"])
            assert result.exit_code == 1

    def test_add_agent_output(self, runner):
        mock_client = self._make_mock_client({"result": "ok"})
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["--agent", "add", "text"])
            assert result.exit_code == 0
            envelope = json.loads(result.output)
            assert envelope["status"] == "ok"
            assert envelope["command"] == "add"
            assert "duration_ms" in envelope


# ---------------------------------------------------------------------------
# 6.4 search command
# ---------------------------------------------------------------------------

class TestSearchCommand:
    def test_search_returns_results(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = [
            {"id": "1", "memory": "test memory", "score": 0.9, "created_at": "2024-01-01"},
        ]
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["search", "query"])
            assert result.exit_code == 0

    def test_search_with_limit(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = []
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["search", "query", "--limit", "10"])
            assert result.exit_code == 0
            call_kwargs = mock_client.search.call_args
            assert call_kwargs[1]["limit"] == 10

    def test_search_empty_results_message(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = []
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["search", "query"])
            assert result.exit_code == 0
            assert "No matching memories found" in result.output

    def test_search_timeout_exit_1(self, runner):
        mock_client = MagicMock()
        mock_client.search.side_effect = Exception("timeout expired")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["search", "query"])
            assert result.exit_code == 1

    def test_search_agent_output(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = [{"id": "1", "memory": "m", "score": 0.5, "created_at": "2024-01-01"}]
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["--agent", "search", "query"])
            assert result.exit_code == 0
            envelope = json.loads(result.output)
            assert envelope["status"] == "ok"
            assert envelope["count"] == 1


# ---------------------------------------------------------------------------
# 6.6 list command
# ---------------------------------------------------------------------------

class TestListCommand:
    def test_list_returns_results(self, runner):
        mock_client = MagicMock()
        mock_client.list_all.return_value = [
            {"id": "1", "memory": "test", "created_at": "2024-01-01"},
        ]
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 0

    def test_list_empty_message(self, runner):
        mock_client = MagicMock()
        mock_client.list_all.return_value = []
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 0
            assert "No memories found" in result.output

    def test_list_agent_output(self, runner):
        mock_client = MagicMock()
        mock_client.list_all.return_value = [{"id": "1", "memory": "m", "created_at": "2024-01-01"}]
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["--agent", "list"])
            assert result.exit_code == 0
            envelope = json.loads(result.output)
            assert envelope["count"] == 1

    def test_list_connection_error(self, runner):
        mock_client = MagicMock()
        mock_client.list_all.side_effect = Exception("Connection refused")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["list"])
            assert result.exit_code == 1


# ---------------------------------------------------------------------------
# 6.7 delete command
# ---------------------------------------------------------------------------

class TestDeleteCommand:
    def test_delete_all_with_force(self, runner):
        mock_client = MagicMock()
        mock_client.delete_all.return_value = {"deleted": True}
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["delete", "--all", "--force"])
            assert result.exit_code == 0
            mock_client.delete_all.assert_called_once()

    def test_delete_all_confirm_yes(self, runner):
        mock_client = MagicMock()
        mock_client.delete_all.return_value = {"deleted": True}
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["delete", "--all"], input="y\n")
            assert result.exit_code == 0
            mock_client.delete_all.assert_called_once()

    def test_delete_all_confirm_no(self, runner):
        mock_client = MagicMock()
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["delete", "--all"], input="n\n")
            assert result.exit_code == 0
            mock_client.delete_all.assert_not_called()
            assert "Cancelled" in result.output

    def test_delete_machine_mode_skips_confirm(self, runner):
        mock_client = MagicMock()
        mock_client.delete_all.return_value = {"deleted": True}
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["--json", "delete", "--all"])
            assert result.exit_code == 0
            mock_client.delete_all.assert_called_once()

    def test_delete_connection_error(self, runner):
        mock_client = MagicMock()
        mock_client.delete_all.side_effect = Exception("Connection refused")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["delete", "--all", "--force"])
            assert result.exit_code == 1

    def test_delete_requires_all_flag(self, runner):
        result = runner.invoke(cli, ["delete"])
        assert result.exit_code != 0


# ---------------------------------------------------------------------------
# 6.8 config subcommand group
# ---------------------------------------------------------------------------

class TestConfigCommand:
    def test_config_show(self, runner):
        cfg = {"api_mode": "sql", "host": "localhost", "password": "secret123"}
        with patch("adbpg_memory_cli.cli.load_config", return_value=cfg), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["config", "show"])
            assert result.exit_code == 0

    def test_config_show_masks_sensitive(self, runner):
        cfg = {"api_mode": "sql", "password": "supersecret"}
        with patch("adbpg_memory_cli.cli.load_config", return_value=cfg), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["--json", "config", "show"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert "supersecret" not in json.dumps(data)
            assert "***" in data.get("password", "")

    def test_config_show_no_config(self, runner):
        with patch("adbpg_memory_cli.cli.load_config", return_value={}), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["config", "show"])
            assert result.exit_code == 2
            full_output = result.output + (getattr(result, "stderr", "") or "")
            assert "init" in full_output

    def test_config_set(self, runner):
        with patch("adbpg_memory_cli.cli.load_config", return_value={"api_mode": "sql"}), \
             patch("adbpg_memory_cli.cli.save_config") as mock_save, \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["config", "set", "host", "newhost"])
            assert result.exit_code == 0
            saved = mock_save.call_args[0][0]
            assert saved["host"] == "newhost"

    def test_config_set_numeric(self, runner):
        with patch("adbpg_memory_cli.cli.load_config", return_value={"api_mode": "sql"}), \
             patch("adbpg_memory_cli.cli.save_config") as mock_save, \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["config", "set", "port", "5433"])
            assert result.exit_code == 0
            saved = mock_save.call_args[0][0]
            assert saved["port"] == 5433

    def test_config_path(self, runner):
        with patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["config", "path"])
            assert result.exit_code == 0
            assert "config.json" in result.output

    def test_config_path_json(self, runner):
        with patch("adbpg_memory_cli.cli.merge_config", return_value={"user_id": "default"}):
            result = runner.invoke(cli, ["--json", "config", "path"])
            assert result.exit_code == 0
            data = json.loads(result.output)
            assert "path" in data


# ---------------------------------------------------------------------------
# 6.9 status command
# ---------------------------------------------------------------------------

class TestStatusCommand:
    def test_status_success_sql(self, runner):
        mock_client = MagicMock()
        mock_client.test_connection.return_value = (True, "Connection successful (internal port: 5432).")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["status"])
            assert result.exit_code == 0

    def test_status_success_rest(self, runner):
        mock_client = MagicMock()
        mock_client.test_connection.return_value = (True, "Connection successful (REST API: https://example.com).")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "rest", "user_id": "default"}):
            result = runner.invoke(cli, ["status"])
            assert result.exit_code == 0

    def test_status_failure_exit_1(self, runner):
        mock_client = MagicMock()
        mock_client.test_connection.return_value = (False, "Connection refused")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["status"])
            assert result.exit_code == 1

    def test_status_exception_exit_1(self, runner):
        mock_client = MagicMock()
        mock_client.test_connection.side_effect = Exception("Network error")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["status"])
            assert result.exit_code == 1

    def test_status_agent_output(self, runner):
        mock_client = MagicMock()
        mock_client.test_connection.return_value = (True, "OK")
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["--agent", "status"])
            assert result.exit_code == 0
            envelope = json.loads(result.output)
            assert envelope["status"] == "ok"
            assert envelope["data"]["connected"] is True


# ---------------------------------------------------------------------------
# 6.10 version command
# ---------------------------------------------------------------------------

class TestVersionCommand:
    def test_version_text(self, runner):
        result = runner.invoke(cli, ["version"])
        assert result.exit_code == 0
        assert __version__ in result.output

    def test_version_json(self, runner):
        result = runner.invoke(cli, ["--json", "version"])
        assert result.exit_code == 0
        data = json.loads(result.output)
        assert data["version"] == __version__

    def test_version_agent(self, runner):
        result = runner.invoke(cli, ["--agent", "version"])
        assert result.exit_code == 0
        envelope = json.loads(result.output)
        assert envelope["status"] == "ok"
        assert envelope["data"]["version"] == __version__

    def test_version_flag_on_group(self, runner):
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0
        assert __version__ in result.output


# ---------------------------------------------------------------------------
# Scope flags
# ---------------------------------------------------------------------------

class TestScopeFlags:
    def test_user_id_flag_overrides_config(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = []
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "config_user"}):
            result = runner.invoke(cli, ["-u", "cli_user", "search", "query"])
            assert result.exit_code == 0
            call_kwargs = mock_client.search.call_args
            assert call_kwargs[1]["user_id"] == "cli_user"

    def test_agent_id_flag(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = []
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["-a", "bot1", "search", "query"])
            assert result.exit_code == 0
            call_kwargs = mock_client.search.call_args
            assert call_kwargs[1]["agent_id"] == "bot1"

    def test_run_id_flag(self, runner):
        mock_client = MagicMock()
        mock_client.search.return_value = []
        with patch("adbpg_memory_cli.cli.ADBPGMemoryCLIClient", return_value=mock_client), \
             patch("adbpg_memory_cli.cli.merge_config", return_value={"api_mode": "sql", "user_id": "default"}):
            result = runner.invoke(cli, ["-r", "run1", "search", "query"])
            assert result.exit_code == 0
            call_kwargs = mock_client.search.call_args
            assert call_kwargs[1]["run_id"] == "run1"
