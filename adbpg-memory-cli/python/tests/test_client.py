"""Unit tests for adbpg_memory_cli.client module."""

import json
from unittest.mock import MagicMock, patch

import pytest

from adbpg_memory_cli.client import (
    ADBPGMemoryCLIClient,
    parse_json_messages,
    text_to_messages,
)


# ------------------------------------------------------------------
# text_to_messages
# ------------------------------------------------------------------

class TestTextToMessages:
    def test_basic_text(self):
        result = text_to_messages("hello world")
        assert result == [{"role": "user", "content": "hello world"}]

    def test_empty_string(self):
        result = text_to_messages("")
        assert result == [{"role": "user", "content": ""}]

    def test_multiline_text(self):
        text = "line1\nline2\nline3"
        result = text_to_messages(text)
        assert len(result) == 1
        assert result[0]["content"] == text

    def test_unicode_text(self):
        text = "你好世界 🌍"
        result = text_to_messages(text)
        assert result[0]["content"] == text


# ------------------------------------------------------------------
# parse_json_messages
# ------------------------------------------------------------------

class TestParseJsonMessages:
    def test_valid_array(self):
        data = [{"role": "user", "content": "hi"}]
        result = parse_json_messages(json.dumps(data))
        assert result == data

    def test_empty_array(self):
        result = parse_json_messages("[]")
        assert result == []

    def test_not_array_raises(self):
        with pytest.raises(ValueError, match="must be an array"):
            parse_json_messages('{"role": "user"}')

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError, match="Invalid JSON"):
            parse_json_messages("not json at all")

    def test_string_value_raises(self):
        with pytest.raises(ValueError, match="must be an array"):
            parse_json_messages('"just a string"')


# ------------------------------------------------------------------
# ADBPGMemoryCLIClient — constructor
# ------------------------------------------------------------------

class TestClientInit:
    def test_default_api_mode_is_sql(self):
        client = ADBPGMemoryCLIClient({})
        assert client.api_mode == "sql"

    def test_rest_api_mode(self):
        client = ADBPGMemoryCLIClient({"api_mode": "rest"})
        assert client.api_mode == "rest"

    def test_config_stored(self):
        cfg = {"api_mode": "sql", "host": "localhost"}
        client = ADBPGMemoryCLIClient(cfg)
        assert client._config is cfg


# ------------------------------------------------------------------
# ADBPGMemoryCLIClient — SQL mode (mocked psycopg2)
# ------------------------------------------------------------------

class TestClientSQLMode:
    """Test SQL mode methods with mocked database connections."""

    def _make_client(self, **overrides):
        cfg = {
            "api_mode": "sql",
            "host": "localhost",
            "port": 5432,
            "user": "test",
            "password": "pass",
            "dbname": "testdb",
            "llm_model": "qwen-plus",
            "llm_api_key": "sk-test",
            "llm_base_url": "https://llm.example.com",
            "embedding_model": "text-embedding-v3",
            "embedding_api_key": "sk-emb",
            "embedding_base_url": "https://emb.example.com",
            "embedding_dims": 1024,
            "search_timeout": 10.0,
        }
        cfg.update(overrides)
        return ADBPGMemoryCLIClient(cfg)

    def _mock_conn(self, fetchone_results=None):
        """Create a mock connection with cursor context manager."""
        conn = MagicMock()
        cursor = MagicMock()
        conn.cursor.return_value.__enter__ = MagicMock(return_value=cursor)
        conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        if fetchone_results is not None:
            cursor.fetchone = MagicMock(side_effect=fetchone_results)
        else:
            cursor.fetchone = MagicMock(return_value=None)

        return conn, cursor

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_add_calls_sql(self, mock_psycopg2):
        client = self._make_client()
        # fetchone calls: 1) internal port query, 2) config, 3) add
        conn, cursor = self._mock_conn(
            fetchone_results=[
                (5432,),  # internal port
                ("ok",),  # config result
                ('{"result": "ok"}',),  # add result
            ]
        )
        mock_psycopg2.connect.return_value = conn

        result = client.add(
            [{"role": "user", "content": "test"}],
            user_id="alice",
        )
        assert result == {"result": "ok"}
        conn.close.assert_called_once()

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_search_calls_sql(self, mock_psycopg2):
        client = self._make_client()
        search_result = json.dumps({"results": [{"id": "1", "memory": "test"}]})
        conn, cursor = self._mock_conn(
            fetchone_results=[
                (5432,),  # internal port
                ("ok",),  # config result
                (search_result,),  # search result
            ]
        )
        mock_psycopg2.connect.return_value = conn

        results = client.search("test query", user_id="alice")
        assert len(results) == 1
        assert results[0]["id"] == "1"
        conn.close.assert_called_once()

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_search_empty_result(self, mock_psycopg2):
        client = self._make_client()
        conn, cursor = self._mock_conn(
            fetchone_results=[
                (5432,),  # internal port
                ("ok",),  # config result
                (None,),  # empty search result
            ]
        )
        mock_psycopg2.connect.return_value = conn

        results = client.search("nothing", user_id="alice")
        assert results == []

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_list_all_calls_sql(self, mock_psycopg2):
        client = self._make_client()
        list_result = json.dumps([{"id": "1", "memory": "mem1"}])
        conn, cursor = self._mock_conn(
            fetchone_results=[
                (5432,),  # internal port
                ("ok",),  # config result
                (list_result,),  # list result
            ]
        )
        mock_psycopg2.connect.return_value = conn

        results = client.list_all(user_id="alice")
        assert len(results) == 1

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_delete_all_calls_sql(self, mock_psycopg2):
        client = self._make_client()
        conn, cursor = self._mock_conn(
            fetchone_results=[
                (5432,),  # internal port
                ("ok",),  # config result
                ('{"deleted": 3}',),  # delete result
            ]
        )
        mock_psycopg2.connect.return_value = conn

        result = client.delete_all(user_id="alice")
        assert result == {"deleted": 3}

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_test_connection_success(self, mock_psycopg2):
        client = self._make_client()
        conn, cursor = self._mock_conn(
            fetchone_results=[(5432,)]
        )
        mock_psycopg2.connect.return_value = conn

        ok, msg = client.test_connection()
        assert ok is True
        assert "5432" in msg

    @patch("adbpg_memory_cli.client.psycopg2")
    def test_test_connection_failure(self, mock_psycopg2):
        client = self._make_client()
        mock_psycopg2.connect.side_effect = Exception("Connection refused")

        ok, msg = client.test_connection()
        assert ok is False
        assert "Connection refused" in msg


# ------------------------------------------------------------------
# ADBPGMemoryCLIClient — REST mode (mocked httpx)
# ------------------------------------------------------------------

class TestClientRESTMode:
    """Test REST mode methods with mocked httpx."""

    def _make_client(self, **overrides):
        cfg = {
            "api_mode": "rest",
            "rest_base_url": "https://api.example.com",
            "rest_api_key": "sk-rest-key",
            "search_timeout": 10.0,
        }
        cfg.update(overrides)
        return ADBPGMemoryCLIClient(cfg)

    def _mock_httpx_client(self, json_response):
        """Create a mock httpx.Client context manager."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = json_response
        mock_resp.text = json.dumps(json_response)
        mock_resp.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.post.return_value = mock_resp
        mock_client.get.return_value = mock_resp
        mock_client.delete.return_value = mock_resp
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        return mock_client

    def test_add_posts_to_memories(self):
        client = self._make_client()
        mock_client = self._mock_httpx_client({"result": "ok"})

        with patch("httpx.Client", return_value=mock_client):
            result = client.add(
                [{"role": "user", "content": "test"}],
                user_id="alice",
            )
        assert result == {"result": "ok"}
        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert "/mem/memories" in call_args[0][0]

    def test_search_posts_to_search(self):
        client = self._make_client()
        mock_client = self._mock_httpx_client(
            {"results": [{"id": "1", "memory": "test"}]}
        )

        with patch("httpx.Client", return_value=mock_client):
            results = client.search("query", user_id="alice")
        assert len(results) == 1
        mock_client.post.assert_called_once()

    def test_list_all_gets_memories(self):
        client = self._make_client()
        mock_client = self._mock_httpx_client(
            {"results": [{"id": "1"}, {"id": "2"}]}
        )

        with patch("httpx.Client", return_value=mock_client):
            results = client.list_all(user_id="alice")
        assert len(results) == 2
        mock_client.get.assert_called_once()

    def test_delete_all_deletes_memories(self):
        client = self._make_client()
        mock_client = self._mock_httpx_client({"deleted": 5})

        with patch("httpx.Client", return_value=mock_client):
            result = client.delete_all(user_id="alice")
        assert result == {"deleted": 5}
        mock_client.delete.assert_called_once()

    def test_test_connection_success(self):
        client = self._make_client()
        mock_client = self._mock_httpx_client({"status": "ok"})

        with patch("httpx.Client", return_value=mock_client):
            ok, msg = client.test_connection()
        assert ok is True
        assert "api.example.com" in msg

    def test_rest_url_construction(self):
        client = self._make_client(rest_base_url="https://api.example.com/")
        assert client._rest_url("/mem/memories") == "https://api.example.com/mem/memories"

    def test_rest_url_no_trailing_slash(self):
        client = self._make_client(rest_base_url="https://api.example.com")
        assert client._rest_url("/mem/memories") == "https://api.example.com/mem/memories"

    def test_rest_headers_include_auth(self):
        client = self._make_client(rest_api_key="mykey")
        headers = client._rest_headers()
        assert headers["X-Auth-Token"] == "static:mykey"
        assert headers["Content-Type"] == "application/json"


# ------------------------------------------------------------------
# No copaw imports
# ------------------------------------------------------------------

class TestNoCopawDependency:
    def test_no_copaw_import_in_client(self):
        """Verify client.py has no copaw imports."""
        import inspect
        import adbpg_memory_cli.client as mod
        source = inspect.getsource(mod)
        assert "import copaw" not in source
        assert "from copaw" not in source


# ------------------------------------------------------------------
# Result parsing helpers
# ------------------------------------------------------------------

class TestParseSearchResult:
    def test_json_string_with_results(self):
        raw = json.dumps({"results": [{"id": "1"}]})
        assert ADBPGMemoryCLIClient._parse_search_result(raw) == [{"id": "1"}]

    def test_json_string_list(self):
        raw = json.dumps([{"id": "1"}])
        assert ADBPGMemoryCLIClient._parse_search_result(raw) == [{"id": "1"}]

    def test_dict_with_results(self):
        raw = {"results": [{"id": "1"}]}
        assert ADBPGMemoryCLIClient._parse_search_result(raw) == [{"id": "1"}]

    def test_list_passthrough(self):
        raw = [{"id": "1"}]
        assert ADBPGMemoryCLIClient._parse_search_result(raw) == [{"id": "1"}]

    def test_none_returns_empty(self):
        assert ADBPGMemoryCLIClient._parse_search_result(None) == []


class TestParseListResult:
    def test_json_string_with_results(self):
        raw = json.dumps({"results": [{"id": "1"}]})
        assert ADBPGMemoryCLIClient._parse_list_result(raw) == [{"id": "1"}]

    def test_json_string_with_memories(self):
        raw = json.dumps({"memories": [{"id": "1"}]})
        assert ADBPGMemoryCLIClient._parse_list_result(raw) == [{"id": "1"}]

    def test_dict_with_memories(self):
        raw = {"memories": [{"id": "1"}]}
        assert ADBPGMemoryCLIClient._parse_list_result(raw) == [{"id": "1"}]

    def test_list_passthrough(self):
        raw = [{"id": "1"}]
        assert ADBPGMemoryCLIClient._parse_list_result(raw) == [{"id": "1"}]
