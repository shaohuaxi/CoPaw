'use strict';

/**
 * Core ADBPG Memory client for CLI use (Node.js).
 *
 * Standalone client equivalent to the Python client.py, with no framework dependencies.
 * Supports SQL mode (pg library) and REST mode (built-in fetch).
 * Uses single connections per operation (no connection pool) for CLI simplicity.
 */

/**
 * Convert plain text to a messages list for the add API.
 * @param {string} text
 * @returns {Array<{role: string, content: string}>}
 */
function textToMessages(text) {
  return [{ role: 'user', content: text }];
}

/**
 * Parse a JSON string into a messages list.
 * Throws Error on invalid JSON or if the result is not an array.
 * @param {string} jsonStr
 * @returns {Array<object>}
 */
function parseJsonMessages(jsonStr) {
  let data;
  try {
    data = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('JSON messages must be an array');
  }
  return data;
}

class ADBPGMemoryCLIClient {
  /**
   * @param {object} config
   */
  constructor(config) {
    this.apiMode = config.api_mode || 'sql';
    this._config = config;
  }

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  /**
   * Add memories. Returns a result object.
   * @param {Array<object>} messages
   * @param {object} [opts]
   * @param {string} [opts.userId]
   * @param {string} [opts.agentId]
   * @param {string} [opts.runId]
   * @param {object} [opts.metadata]
   * @param {string} [opts.prompt]
   * @returns {Promise<object>}
   */
  async add(messages, { userId, agentId, runId, metadata, prompt } = {}) {
    if (this.apiMode === 'rest') {
      return this._restAdd(messages, userId, agentId, runId, metadata);
    }
    return this._sqlAdd(messages, userId, agentId, runId, metadata, prompt);
  }

  /**
   * Semantic search. Returns a list of memory objects.
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.userId]
   * @param {string} [opts.agentId]
   * @param {string} [opts.runId]
   * @param {number} [opts.limit=5]
   * @returns {Promise<Array<object>>}
   */
  async search(query, { userId, agentId, runId, limit = 5 } = {}) {
    if (this.apiMode === 'rest') {
      return this._restSearch(query, userId, agentId, runId, limit);
    }
    return this._sqlSearch(query, userId, agentId, runId, limit);
  }

  /**
   * List all memories for the given scope.
   * @param {object} [opts]
   * @param {string} [opts.userId]
   * @param {string} [opts.agentId]
   * @param {string} [opts.runId]
   * @returns {Promise<Array<object>>}
   */
  async listAll({ userId, agentId, runId } = {}) {
    if (this.apiMode === 'rest') {
      return this._restListAll(userId, agentId, runId);
    }
    return this._sqlListAll(userId, agentId, runId);
  }

  /**
   * Delete all memories for the given scope. Returns a result object.
   * @param {object} [opts]
   * @param {string} [opts.userId]
   * @param {string} [opts.agentId]
   * @param {string} [opts.runId]
   * @returns {Promise<object>}
   */
  async deleteAll({ userId, agentId, runId } = {}) {
    if (this.apiMode === 'rest') {
      return this._restDeleteAll(userId, agentId, runId);
    }
    return this._sqlDeleteAll(userId, agentId, runId);
  }

  /**
   * Test connectivity. Returns { success: boolean, message: string }.
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async testConnection() {
    if (this.apiMode === 'rest') {
      return this._restTestConnection();
    }
    return this._sqlTestConnection();
  }

  // ------------------------------------------------------------------
  // SQL helpers
  // ------------------------------------------------------------------

  /**
   * Create a new pg Client connection from config.
   * @returns {import('pg').Client}
   */
  _sqlCreateClient() {
    const { Client } = require('pg');
    return new Client({
      host: this._config.host || '',
      port: this._config.port || 5432,
      user: this._config.user || '',
      password: this._config.password || '',
      database: this._config.dbname || '',
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Run adbpg_llm_memory.config() on the connection.
   * Returns the detected internal port.
   * @param {import('pg').Client} client
   * @returns {Promise<number>}
   */
  async _sqlConfigureConnection(client) {
    // Query internal port
    const portRes = await client.query(
      "SELECT port FROM gp_segment_configuration WHERE content = -1 AND role = 'p'"
    );
    if (!portRes.rows.length || !portRes.rows[0].port) {
      throw new Error('gp_segment_configuration returned no master port row.');
    }
    const vectorPort = parseInt(portRes.rows[0].port, 10);

    const configJson = {
      llm: {
        provider: 'qwen',
        config: {
          model: this._config.llm_model || '',
          qwen_base_url: this._config.llm_base_url || '',
          api_key: this._config.llm_api_key || '',
        },
      },
      embedder: {
        provider: 'openai',
        config: {
          model: this._config.embedding_model || '',
          api_key: this._config.embedding_api_key || '',
          embedding_dims: String(this._config.embedding_dims || 1024),
          openai_base_url: this._config.embedding_base_url || '',
        },
      },
      vector_store: {
        provider: 'adbpg',
        config: {
          user: this._config.user || '',
          dbname: this._config.dbname || '',
          password: this._config.password || '',
          port: String(vectorPort),
          embedding_model_dims: String(this._config.embedding_dims || 1024),
        },
      },
    };

    const customPrompt = this._config.custom_fact_extraction_prompt || '';
    if (customPrompt) {
      configJson.custom_fact_extraction_prompt = customPrompt;
    }

    await client.query('SELECT adbpg_llm_memory.config($1::json)', [
      JSON.stringify(configJson),
    ]);

    return vectorPort;
  }

  /**
   * @param {Array<object>} messages
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @param {object} [metadata]
   * @param {string} [prompt]
   * @returns {Promise<object>}
   */
  async _sqlAdd(messages, userId, agentId, runId, metadata, prompt) {
    const client = this._sqlCreateClient();
    try {
      await client.connect();
      await this._sqlConfigureConnection(client);

      const sql =
        'SELECT adbpg_llm_memory.add($1::json, $2, $3, $4, $5, $6, $7)';
      const params = [
        JSON.stringify(messages),
        userId || null,
        runId || null,
        agentId || null,
        metadata ? JSON.stringify(metadata) : null,
        prompt || null,
        null,
      ];
      const res = await client.query(sql, params);
      const raw = res.rows.length ? res.rows[0][Object.keys(res.rows[0])[0]] : null;
      return ADBPGMemoryCLIClient._parseJsonResult(raw);
    } finally {
      await client.end();
    }
  }

  /**
   * @param {string} query
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async _sqlSearch(query, userId, agentId, runId, limit) {
    const timeout = this._config.search_timeout || 10.0;
    const timeoutMs = Math.floor(Number(timeout) * 1000);

    const client = this._sqlCreateClient();
    try {
      await client.connect();
      await this._sqlConfigureConnection(client);

      await client.query(`SET statement_timeout = ${timeoutMs}`);
      try {
        const sql =
          'SELECT adbpg_llm_memory.search($1, $2, $3, $4, $5)';
        const params = [
          query,
          userId || null,
          runId || null,
          agentId || null,
          null,
        ];
        const res = await client.query(sql, params);
        if (res.rows.length && res.rows[0]) {
          const raw = res.rows[0][Object.keys(res.rows[0])[0]];
          if (raw) {
            return ADBPGMemoryCLIClient._parseSearchResult(raw);
          }
        }
        return [];
      } finally {
        try {
          await client.query('SET statement_timeout = 0');
        } catch (_) {
          // ignore
        }
      }
    } finally {
      await client.end();
    }
  }

  /**
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @returns {Promise<Array<object>>}
   */
  async _sqlListAll(userId, agentId, runId) {
    const client = this._sqlCreateClient();
    try {
      await client.connect();
      await this._sqlConfigureConnection(client);

      const sql = 'SELECT adbpg_llm_memory.get_all($1, $2, $3)';
      const params = [userId || null, runId || null, agentId || null];
      const res = await client.query(sql, params);
      if (res.rows.length && res.rows[0]) {
        const raw = res.rows[0][Object.keys(res.rows[0])[0]];
        if (raw) {
          return ADBPGMemoryCLIClient._parseListResult(raw);
        }
      }
      return [];
    } finally {
      await client.end();
    }
  }

  /**
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @returns {Promise<object>}
   */
  async _sqlDeleteAll(userId, agentId, runId) {
    const client = this._sqlCreateClient();
    try {
      await client.connect();
      await this._sqlConfigureConnection(client);

      const sql = 'SELECT adbpg_llm_memory.delete_all($1, $2, $3)';
      const params = [userId || null, runId || null, agentId || null];
      const res = await client.query(sql, params);
      const raw = res.rows.length ? res.rows[0][Object.keys(res.rows[0])[0]] : null;
      return ADBPGMemoryCLIClient._parseJsonResult(raw);
    } finally {
      await client.end();
    }
  }

  /**
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async _sqlTestConnection() {
    let client;
    try {
      client = this._sqlCreateClient();
      await client.connect();
      const res = await client.query(
        "SELECT port FROM gp_segment_configuration WHERE content = -1 AND role = 'p'"
      );
      if (res.rows.length && res.rows[0].port) {
        return {
          success: true,
          message: `Connection successful (internal port: ${res.rows[0].port}).`,
        };
      }
      return {
        success: false,
        message:
          'Connected but gp_segment_configuration returned no master row.',
      };
    } catch (e) {
      return { success: false, message: String(e.message || e) };
    } finally {
      if (client) {
        try {
          await client.end();
        } catch (_) {
          // ignore
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // REST helpers
  // ------------------------------------------------------------------

  /**
   * Build a full REST URL from a path.
   * @param {string} urlPath
   * @returns {string}
   */
  _restUrl(urlPath) {
    const base = (this._config.rest_base_url || '').replace(/\/+$/, '');
    return `${base}${urlPath}`;
  }

  /**
   * Build REST headers including auth token.
   * @returns {object}
   */
  _restHeaders() {
    return {
      'X-Auth-Token': `static:${this._config.rest_api_key || ''}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get REST timeout in milliseconds.
   * @returns {number}
   */
  _restTimeoutMs() {
    return Math.floor(Number(this._config.search_timeout || 10.0) * 1000);
  }

  /**
   * @param {Array<object>} messages
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @param {object} [metadata]
   * @returns {Promise<object>}
   */
  async _restAdd(messages, userId, agentId, runId, metadata) {
    const body = { messages };
    if (userId) body.user_id = userId;
    if (agentId) body.agent_id = agentId;
    if (runId) body.run_id = runId;
    if (metadata) body.metadata = metadata;

    const url = this._restUrl('/mem/memories');
    const timeoutMs = Math.max(this._restTimeoutMs(), 30000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: this._restHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      try {
        return await resp.json();
      } catch (_) {
        return { result: await resp.text() };
      }
    } catch (e) {
      throw new Error(ADBPGMemoryCLIClient._enhanceError(e, url));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} query
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @param {number} limit
   * @returns {Promise<Array<object>>}
   */
  async _restSearch(query, userId, agentId, runId, limit) {
    const body = { query };
    if (userId) body.user_id = userId;
    if (agentId) body.agent_id = agentId;
    if (runId) body.run_id = runId;

    const url = this._restUrl('/mem/search');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._restTimeoutMs());

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: this._restHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      let results;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        results = data.results || [];
      } else if (Array.isArray(data)) {
        results = data;
      } else {
        results = [];
      }
      return results.slice(0, limit);
    } catch (e) {
      if (e.message && e.message.startsWith('HTTP ')) throw e;
      throw new Error(ADBPGMemoryCLIClient._enhanceError(e, url));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @returns {Promise<Array<object>>}
   */
  async _restListAll(userId, agentId, runId) {
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (agentId) params.set('agent_id', agentId);
    if (runId) params.set('run_id', runId);

    const qs = params.toString();
    const url = this._restUrl('/mem/memories') + (qs ? `?${qs}` : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._restTimeoutMs());

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: this._restHeaders(),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data.results || data.memories || [];
      }
      if (Array.isArray(data)) {
        return data;
      }
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {string} [userId]
   * @param {string} [agentId]
   * @param {string} [runId]
   * @returns {Promise<object>}
   */
  async _restDeleteAll(userId, agentId, runId) {
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (agentId) params.set('agent_id', agentId);
    if (runId) params.set('run_id', runId);

    const qs = params.toString();
    const url = this._restUrl('/mem/memories') + (qs ? `?${qs}` : '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._restTimeoutMs());

    try {
      const resp = await fetch(url, {
        method: 'DELETE',
        headers: this._restHeaders(),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      try {
        return await resp.json();
      } catch (_) {
        return { result: await resp.text() };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @returns {Promise<{success: boolean, message: string}>}
   */
  async _restTestConnection() {
    const url = this._restUrl('/mem/health');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: this._restHeaders(),
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const baseUrl = this._config.rest_base_url || '';
      return {
        success: true,
        message: `Connection successful (REST API: ${baseUrl}).`,
      };
    } catch (e) {
      return { success: false, message: String(e.message || e) };
    } finally {
      clearTimeout(timer);
    }
  }

  // ------------------------------------------------------------------
  // Result parsing helpers
  // ------------------------------------------------------------------

  /**
   * Enhance fetch/network errors with actionable hints.
   * @param {Error} e
   * @param {string} url
   * @returns {string}
   */
  static _enhanceError(e, url) {
    const msg = e.message || String(e);
    if (/fetch failed|unable to get local issuer|self.signed|UNABLE_TO_VERIFY/i.test(msg)) {
      return `${msg} (SSL certificate error? Try: NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem ...)`;
    }
    if (/ECONNREFUSED/i.test(msg)) {
      return `${msg} (Connection refused. Check rest_base_url: ${url})`;
    }
    if (/abort/i.test(msg)) {
      return `${msg} (Request timed out. Check network or increase search_timeout)`;
    }
    if (/401|unauthorized/i.test(msg)) {
      return `${msg} (Authentication failed. Check rest_api_key with: adbpg-mem config show)`;
    }
    return msg;
  }

  /**
   * Parse a raw JSON result (string or object) into a plain object.
   * Used for add/delete results.
   * @param {*} raw
   * @returns {object}
   */
  static _parseJsonResult(raw) {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch (_) {
        try {
          return JSON.parse(raw.replace(/'/g, '"').replace(/None/g, 'null').replace(/True/g, 'true').replace(/False/g, 'false'));
        } catch (_2) {
          return { result: raw };
        }
      }
    }
    if (raw && typeof raw === 'object') {
      return raw;
    }
    return { result: raw };
  }

  /**
   * Parse the raw result from adbpg_llm_memory.search().
   * Handles string (JSON), dict with "results" key, or list.
   * @param {*} raw
   * @returns {Array<object>}
   */
  static _parseSearchResult(raw) {
    if (typeof raw === 'string') {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        // ADBPG SQL returns Python repr format (single quotes) — try converting
        try {
          parsed = JSON.parse(raw.replace(/'/g, '"').replace(/None/g, 'null').replace(/True/g, 'true').replace(/False/g, 'false'));
        } catch (_2) {
          return [];
        }
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed.results || [];
      }
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw.results || [];
    }
    if (Array.isArray(raw)) {
      return raw;
    }
    return [];
  }

  /**
   * Parse the raw result from adbpg_llm_memory.get_all().
   * Handles string (JSON), dict with "results"/"memories" key, or list.
   * @param {*} raw
   * @returns {Array<object>}
   */
  static _parseListResult(raw) {
    if (typeof raw === 'string') {
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (_) {
        try {
          parsed = JSON.parse(raw.replace(/'/g, '"').replace(/None/g, 'null').replace(/True/g, 'true').replace(/False/g, 'false'));
        } catch (_2) {
          return [];
        }
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed.results || parsed.memories || [];
      }
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return [];
    }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw.results || raw.memories || [];
    }
    if (Array.isArray(raw)) {
      return raw;
    }
    return [];
  }
}

module.exports = {
  textToMessages,
  parseJsonMessages,
  ADBPGMemoryCLIClient,
};
