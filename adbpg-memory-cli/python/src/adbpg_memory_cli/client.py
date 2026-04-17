"""Core ADBPG Memory client for CLI use.

Standalone client extracted from adbpg_client.py, with no CoPaw dependencies.
Supports SQL mode (psycopg2) and REST mode (httpx).
Uses single connections per operation (no connection pool) for CLI simplicity.
"""

import ast
import json
from typing import Any

try:
    import psycopg2
except ImportError:
    psycopg2 = None  # type: ignore[assignment]


def text_to_messages(text: str) -> list[dict]:
    """Convert plain text to a messages list for the add API."""
    return [{"role": "user", "content": text}]


def parse_json_messages(json_str: str) -> list[dict]:
    """Parse a JSON string into a messages list. Raises ValueError on invalid JSON."""
    try:
        data = json.loads(json_str)
    except json.JSONDecodeError as e:
        raise ValueError(f"Invalid JSON: {e}") from e
    if not isinstance(data, list):
        raise ValueError("JSON messages must be an array")
    return data


class ADBPGMemoryCLIClient:
    """Standalone ADBPG Memory client supporting SQL and REST modes."""

    def __init__(self, config: dict):
        self.api_mode = config.get("api_mode", "sql")
        self._config = config

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add(
        self,
        messages: list[dict],
        user_id: str = "",
        agent_id: str | None = None,
        run_id: str | None = None,
        metadata: dict | None = None,
        prompt: str | None = None,
    ) -> dict:
        """Add memories. Returns a result dict."""
        if self.api_mode == "rest":
            return self._rest_add(messages, user_id, agent_id, run_id, metadata)
        return self._sql_add(messages, user_id, agent_id, run_id, metadata, prompt)

    def search(
        self,
        query: str,
        user_id: str = "",
        agent_id: str | None = None,
        run_id: str | None = None,
        limit: int = 5,
    ) -> list[dict]:
        """Semantic search. Returns a list of memory dicts."""
        if self.api_mode == "rest":
            return self._rest_search(query, user_id, agent_id, run_id, limit)
        return self._sql_search(query, user_id, agent_id, run_id, limit)

    def list_all(
        self,
        user_id: str = "",
        agent_id: str | None = None,
        run_id: str | None = None,
    ) -> list[dict]:
        """List all memories for the given scope."""
        if self.api_mode == "rest":
            return self._rest_list_all(user_id, agent_id, run_id)
        return self._sql_list_all(user_id, agent_id, run_id)

    def delete_all(
        self,
        user_id: str = "",
        agent_id: str | None = None,
        run_id: str | None = None,
    ) -> dict:
        """Delete all memories for the given scope. Returns a result dict."""
        if self.api_mode == "rest":
            return self._rest_delete_all(user_id, agent_id, run_id)
        return self._sql_delete_all(user_id, agent_id, run_id)

    def test_connection(self) -> tuple[bool, str]:
        """Test connectivity. Returns (success, message)."""
        if self.api_mode == "rest":
            return self._rest_test_connection()
        return self._sql_test_connection()

    # ------------------------------------------------------------------
    # SQL helpers
    # ------------------------------------------------------------------

    def _sql_connect(self):
        """Create a new psycopg2 connection from config."""
        if psycopg2 is None:
            raise ImportError(
                "psycopg2 is required for SQL mode. "
                "Install it with: pip install psycopg2-binary"
            )
        return psycopg2.connect(
            host=self._config.get("host", ""),
            port=self._config.get("port", 5432),
            user=self._config.get("user", ""),
            password=self._config.get("password", ""),
            dbname=self._config.get("dbname", ""),
            connect_timeout=10,
        )

    def _sql_configure_connection(self, conn) -> int:
        """Run adbpg_llm_memory.config() on the connection.

        Returns the detected internal port.
        """
        # Query internal port
        with conn.cursor() as cur:
            cur.execute(
                "SELECT port FROM gp_segment_configuration "
                "WHERE content = -1 AND role = 'p'"
            )
            row = cur.fetchone()
            if not row or not row[0]:
                raise RuntimeError(
                    "gp_segment_configuration returned no master port row."
                )
            vector_port = int(row[0])

        config_json: dict[str, Any] = {
            "llm": {
                "provider": "qwen",
                "config": {
                    "model": self._config.get("llm_model", ""),
                    "qwen_base_url": self._config.get("llm_base_url", ""),
                    "api_key": self._config.get("llm_api_key", ""),
                },
            },
            "embedder": {
                "provider": "openai",
                "config": {
                    "model": self._config.get("embedding_model", ""),
                    "api_key": self._config.get("embedding_api_key", ""),
                    "embedding_dims": str(
                        self._config.get("embedding_dims", 1024)
                    ),
                    "openai_base_url": self._config.get("embedding_base_url", ""),
                },
            },
            "vector_store": {
                "provider": "adbpg",
                "config": {
                    "user": self._config.get("user", ""),
                    "dbname": self._config.get("dbname", ""),
                    "password": self._config.get("password", ""),
                    "port": str(vector_port),
                    "embedding_model_dims": str(
                        self._config.get("embedding_dims", 1024)
                    ),
                },
            },
        }

        custom_prompt = self._config.get("custom_fact_extraction_prompt", "")
        if custom_prompt:
            config_json["custom_fact_extraction_prompt"] = custom_prompt

        sql = "SELECT adbpg_llm_memory.config(%s::json)"
        with conn.cursor() as cur:
            cur.execute(sql, (json.dumps(config_json),))
            cur.fetchone()
        conn.commit()
        return vector_port

    def _sql_add(
        self,
        messages: list[dict],
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
        metadata: dict | None,
        prompt: str | None,
    ) -> dict:
        conn = self._sql_connect()
        try:
            self._sql_configure_connection(conn)
            sql = (
                "SELECT adbpg_llm_memory.add("
                "%s::json, %s, %s, %s, %s, %s, %s"
                ")"
            )
            params = (
                json.dumps(messages),
                user_id or None,
                run_id,
                agent_id,
                json.dumps(metadata) if metadata else None,
                prompt,
                None,
            )
            with conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
            conn.commit()
            result = row[0] if row else None
            if isinstance(result, str):
                try:
                    return json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    return {"result": result}
            if isinstance(result, dict):
                return result
            return {"result": result}
        finally:
            conn.close()

    def _sql_search(
        self,
        query: str,
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
        limit: int,
    ) -> list[dict]:
        timeout = self._config.get("search_timeout", 10.0)
        timeout_ms = int(float(timeout) * 1000)

        conn = self._sql_connect()
        try:
            self._sql_configure_connection(conn)
            with conn.cursor() as cur:
                cur.execute(f"SET statement_timeout = {timeout_ms}")
                try:
                    sql = (
                        "SELECT adbpg_llm_memory.search("
                        "%s, %s, %s, %s, %s"
                        ")"
                    )
                    params = (
                        query,
                        user_id or None,
                        run_id,
                        agent_id,
                        None,
                    )
                    cur.execute(sql, params)
                    result = cur.fetchone()
                    if result and result[0]:
                        return self._parse_search_result(result[0])
                    return []
                finally:
                    try:
                        cur.execute("SET statement_timeout = 0")
                    except Exception:
                        pass
            conn.commit()
            return []
        finally:
            conn.close()

    def _sql_list_all(
        self,
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
    ) -> list[dict]:
        conn = self._sql_connect()
        try:
            self._sql_configure_connection(conn)
            sql = "SELECT adbpg_llm_memory.get_all(%s, %s, %s)"
            params = (user_id or None, run_id, agent_id)
            with conn.cursor() as cur:
                cur.execute(sql, params)
                result = cur.fetchone()
            conn.commit()
            if result and result[0]:
                return self._parse_list_result(result[0])
            return []
        finally:
            conn.close()

    def _sql_delete_all(
        self,
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
    ) -> dict:
        conn = self._sql_connect()
        try:
            self._sql_configure_connection(conn)
            sql = "SELECT adbpg_llm_memory.delete_all(%s, %s, %s)"
            params = (user_id or None, run_id, agent_id)
            with conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
            conn.commit()
            result = row[0] if row else None
            if isinstance(result, str):
                try:
                    return json.loads(result)
                except (json.JSONDecodeError, TypeError):
                    return {"result": result}
            if isinstance(result, dict):
                return result
            return {"result": result}
        finally:
            conn.close()

    def _sql_test_connection(self) -> tuple[bool, str]:
        if psycopg2 is None:
            return False, "psycopg2 is not installed."
        conn = None
        try:
            conn = self._sql_connect()
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT port FROM gp_segment_configuration "
                    "WHERE content = -1 AND role = 'p'"
                )
                row = cur.fetchone()
                if row and row[0]:
                    return True, f"Connection successful (internal port: {row[0]})."
                return False, (
                    "Connected but gp_segment_configuration "
                    "returned no master row."
                )
        except Exception as e:
            return False, str(e)
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    # ------------------------------------------------------------------
    # REST helpers
    # ------------------------------------------------------------------

    def _rest_url(self, path: str) -> str:
        base = self._config.get("rest_base_url", "").rstrip("/")
        return f"{base}{path}"

    def _rest_headers(self) -> dict[str, str]:
        return {
            "X-Auth-Token": f"static:{self._config.get('rest_api_key', '')}",
            "Content-Type": "application/json",
        }

    def _rest_timeout(self) -> float:
        return float(self._config.get("search_timeout", 10.0))

    def _rest_add(
        self,
        messages: list[dict],
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
        metadata: dict | None,
    ) -> dict:
        import httpx

        body: dict[str, Any] = {"messages": messages}
        if user_id:
            body["user_id"] = user_id
        if agent_id:
            body["agent_id"] = agent_id
        if run_id:
            body["run_id"] = run_id
        if metadata:
            body["metadata"] = metadata

        url = self._rest_url("/mem/memories")
        with httpx.Client(
            timeout=max(self._rest_timeout(), 30.0),
            follow_redirects=True,
        ) as client:
            resp = client.post(url, headers=self._rest_headers(), json=body)
            resp.raise_for_status()
            try:
                return resp.json()
            except Exception:
                return {"result": resp.text}

    def _rest_search(
        self,
        query: str,
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
        limit: int,
    ) -> list[dict]:
        import httpx

        body: dict[str, Any] = {"query": query}
        if user_id:
            body["user_id"] = user_id
        if agent_id:
            body["agent_id"] = agent_id
        if run_id:
            body["run_id"] = run_id

        url = self._rest_url("/mem/search")
        with httpx.Client(
            timeout=self._rest_timeout(),
            follow_redirects=True,
        ) as client:
            resp = client.post(url, headers=self._rest_headers(), json=body)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                results = data.get("results", [])
            elif isinstance(data, list):
                results = data
            else:
                results = []
            return results[:limit]

    def _rest_list_all(
        self,
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
    ) -> list[dict]:
        import httpx

        params: dict[str, str] = {}
        if user_id:
            params["user_id"] = user_id
        if agent_id:
            params["agent_id"] = agent_id
        if run_id:
            params["run_id"] = run_id

        url = self._rest_url("/mem/memories")
        with httpx.Client(
            timeout=self._rest_timeout(),
            follow_redirects=True,
        ) as client:
            resp = client.get(url, headers=self._rest_headers(), params=params)
            resp.raise_for_status()
            data = resp.json()
            if isinstance(data, dict):
                return data.get("results", data.get("memories", []))
            if isinstance(data, list):
                return data
            return []

    def _rest_delete_all(
        self,
        user_id: str,
        agent_id: str | None,
        run_id: str | None,
    ) -> dict:
        import httpx

        params: dict[str, str] = {}
        if user_id:
            params["user_id"] = user_id
        if agent_id:
            params["agent_id"] = agent_id
        if run_id:
            params["run_id"] = run_id

        url = self._rest_url("/mem/memories")
        with httpx.Client(
            timeout=self._rest_timeout(),
            follow_redirects=True,
        ) as client:
            resp = client.delete(url, headers=self._rest_headers(), params=params)
            resp.raise_for_status()
            try:
                return resp.json()
            except Exception:
                return {"result": resp.text}

    def _rest_test_connection(self) -> tuple[bool, str]:
        import httpx

        url = self._rest_url("/mem/health")
        try:
            with httpx.Client(timeout=10.0, follow_redirects=True) as client:
                resp = client.get(url, headers=self._rest_headers())
                resp.raise_for_status()
                base_url = self._config.get("rest_base_url", "")
                return True, f"Connection successful (REST API: {base_url})."
        except Exception as e:
            return False, str(e)

    # ------------------------------------------------------------------
    # Result parsing helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_search_result(raw: Any) -> list[dict]:
        """Parse the raw result from adbpg_llm_memory.search()."""
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = ast.literal_eval(raw)
            if isinstance(parsed, dict):
                return parsed.get("results", [])
            if isinstance(parsed, list):
                return parsed
            return []
        if isinstance(raw, dict):
            return raw.get("results", [])
        if isinstance(raw, list):
            return raw
        return []

    @staticmethod
    def _parse_list_result(raw: Any) -> list[dict]:
        """Parse the raw result from adbpg_llm_memory.get_all()."""
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = ast.literal_eval(raw)
            if isinstance(parsed, dict):
                return parsed.get("results", parsed.get("memories", []))
            if isinstance(parsed, list):
                return parsed
            return []
        if isinstance(raw, dict):
            return raw.get("results", raw.get("memories", []))
        if isinstance(raw, list):
            return raw
        return []
