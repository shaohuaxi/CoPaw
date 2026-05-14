#!/usr/bin/env node
/**
 * adbpg-mem.mjs — zero-dependency single-file ESM port of the adbpg-mem REST CLI
 * for the Wukong sandbox (macOS, Node 18+, no npm install, restricted PATH).
 *
 * - Mirrors the REST subset of node/src/cli.js so agents can keep using the
 *   same JSON envelope and per-agent config semantics.
 * - Adds a sandbox bootstrap (`config init <url> <key>`) plus a three-level
 *   config fallback (env > workspace cwd > user home).
 * - Imports only Node built-ins (node:fs / node:path / node:os / node:process).
 *
 * The standalone `node:test` suite for this script lives in adbpg-mem.test.mjs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ISOLATION_RUN_MODES = ['off', 'manual', 'auto', 'tag'];

const AGENT_CONFIG_SCHEMA = {
  isolation_agent: { type: 'boolean', default: false },
  isolation_run_mode: { type: 'enum', values: ISOLATION_RUN_MODES, default: 'off' },
  current_run_id: { type: 'string' },
};
const AGENT_CONFIG_KNOWN_KEYS = Object.keys(AGENT_CONFIG_SCHEMA);

const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const DEFAULT_SEARCH_TIMEOUT_S = 10;
const ADD_MIN_TIMEOUT_MS = 30000;

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

/**
 * Load config with three-tier fallback:
 *   1. Environment vars (ADBPG_REST_BASE_URL + ADBPG_REST_API_KEY required together)
 *   2. <cwd>/.adbpg-mem/config.json   — sandbox workspace config
 *   3. <home>/.adbpg-mem/config.json  — local-terminal compatibility
 *
 * Returns { config, source } on success. `source` is one of:
 *   "env" | "<absolute path>" | null
 *
 * Returns { config: null, source: null } when nothing configured.
 *
 * Optional injection points (mainly for tests): opts.env, opts.cwd, opts.homedir.
 */
function loadConfig(opts = {}) {
  const env = opts.env || process.env;
  const cwd = opts.cwd || process.cwd();
  const homedir = opts.homedir || os.homedir();

  // 1. Environment variables
  if (env.ADBPG_REST_BASE_URL && env.ADBPG_REST_API_KEY) {
    const cfg = {
      api_mode: 'rest',
      rest_base_url: env.ADBPG_REST_BASE_URL,
      rest_api_key: env.ADBPG_REST_API_KEY,
      user_id: env.ADBPG_USER_ID || 'default',
      search_timeout: env.ADBPG_SEARCH_TIMEOUT
        ? Number(env.ADBPG_SEARCH_TIMEOUT)
        : DEFAULT_SEARCH_TIMEOUT_S,
    };
    return { config: cfg, source: 'env' };
  }

  // 2. workspace cwd config
  const cwdPath = path.join(cwd, '.adbpg-mem', 'config.json');
  const cwdCfg = readConfigFile(cwdPath);
  if (cwdCfg && cwdCfg.rest_base_url && cwdCfg.rest_api_key) {
    return { config: normalizeConfig(cwdCfg), source: cwdPath };
  }

  // 3. user home config
  const homePath = path.join(homedir, '.adbpg-mem', 'config.json');
  const homeCfg = readConfigFile(homePath);
  if (homeCfg && homeCfg.rest_base_url && homeCfg.rest_api_key) {
    return { config: normalizeConfig(homeCfg), source: homePath };
  }

  return { config: null, source: null };
}

function readConfigFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function normalizeConfig(cfg) {
  const out = {
    api_mode: 'rest',
    rest_base_url: cfg.rest_base_url,
    rest_api_key: cfg.rest_api_key,
    user_id: cfg.user_id || 'default',
    search_timeout:
      typeof cfg.search_timeout === 'number'
        ? cfg.search_timeout
        : DEFAULT_SEARCH_TIMEOUT_S,
  };
  return out;
}

function configMissingMessage() {
  return [
    'adbpg-mem: missing REST configuration. Please either:',
    '  1. Set env vars: export ADBPG_REST_BASE_URL=<url> ADBPG_REST_API_KEY=<key>',
    '  2. Or run: node scripts/adbpg-mem.mjs config init <url> <key>',
    '  3. Or create ~/.adbpg-mem/config.json with {api_mode:"rest", rest_base_url:..., rest_api_key:...}',
  ].join('\n');
}

/**
 * Mask a sensitive value: show first 3 + last 3 chars with **** between.
 * Short strings get fully masked.
 */
function maskValue(v) {
  if (typeof v !== 'string' || v.length === 0) return '';
  if (v.length <= 8) return '****';
  return `${v.slice(0, 3)}****${v.slice(-3)}`;
}

function maskedConfigView(cfg) {
  return {
    api_mode: cfg.api_mode,
    rest_base_url: cfg.rest_base_url,
    rest_api_key: maskValue(cfg.rest_api_key || ''),
    user_id: cfg.user_id,
    search_timeout: cfg.search_timeout,
  };
}

/**
 * Persist a REST config to <cwd>/.adbpg-mem/config.json with mode 0600.
 * Returns the absolute path.
 */
function saveConfigAtCwd(restBaseUrl, restApiKey, userId, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const dir = path.join(cwd, '.adbpg-mem');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const filePath = path.join(dir, 'config.json');
  const cfg = {
    api_mode: 'rest',
    rest_base_url: restBaseUrl,
    rest_api_key: restApiKey,
    user_id: userId || 'default',
    search_timeout: DEFAULT_SEARCH_TIMEOUT_S,
  };
  fs.writeFileSync(filePath, JSON.stringify(cfg, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) {
    // best-effort
  }
  return filePath;
}

// ---------------------------------------------------------------------------
// Agent-config persistence
// ---------------------------------------------------------------------------

function agentsDir(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  return path.join(cwd, '.adbpg-mem', 'agents');
}

function agentConfigPath(agentId, opts = {}) {
  return path.join(agentsDir(opts), `${agentId}.json`);
}

function validateAgentId(agentId) {
  if (agentId === undefined || agentId === null || agentId === '') {
    return 'agent_id is required';
  }
  if (typeof agentId !== 'string') return 'agent_id must be a string';
  if (agentId.length > 64) return 'agent_id exceeds 64 characters';
  if (!AGENT_ID_RE.test(agentId)) {
    return 'agent_id must match [a-zA-Z0-9_-] and be 1-64 chars';
  }
  return null;
}

function loadAgentConfig(agentId, opts = {}) {
  const filePath = agentConfigPath(agentId, opts);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (_) {
    return {};
  }
}

function saveAgentConfig(agentId, config, opts = {}) {
  const filePath = agentConfigPath(agentId, opts);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) {
    // best-effort
  }
}

function applyAgentDefaults(stored) {
  const out = {};
  for (const [key, def] of Object.entries(AGENT_CONFIG_SCHEMA)) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) {
      out[key] = stored[key];
    } else if (def.default !== undefined) {
      out[key] = def.default;
    }
  }
  return out;
}

function parseAgentValue(key, rawValue) {
  if (!Object.prototype.hasOwnProperty.call(AGENT_CONFIG_SCHEMA, key)) {
    return {
      ok: false,
      error: `unknown key '${key}'. Known keys: ${AGENT_CONFIG_KNOWN_KEYS.join(', ')}`,
    };
  }
  const def = AGENT_CONFIG_SCHEMA[key];

  if (def.type === 'boolean') {
    if (typeof rawValue !== 'string') {
      return {
        ok: false,
        error: `invalid value for ${key}: expected boolean string, got ${typeof rawValue}`,
      };
    }
    // case-insensitive but no trim — match Node CLI behavior
    const lowered = rawValue.toLowerCase();
    if (lowered === 'true') return { ok: true, value: true };
    if (lowered === 'false') return { ok: true, value: false };
    return {
      ok: false,
      error: `invalid value for ${key}: expected 'true' or 'false', got '${rawValue}'`,
    };
  }

  if (def.type === 'enum') {
    if (!def.values.includes(rawValue)) {
      return {
        ok: false,
        error: `invalid value for ${key}: must be one of ${def.values.join(', ')}, got '${rawValue}'`,
      };
    }
    return { ok: true, value: rawValue };
  }

  if (def.type === 'string') {
    if (typeof rawValue !== 'string' || rawValue === '') {
      return { ok: false, error: `invalid value for ${key}: expected non-empty string` };
    }
    return { ok: true, value: rawValue };
  }

  return { ok: false, error: `invalid value for ${key}: unsupported type` };
}

function agentConfigShow(agentId, opts = {}) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: `invalid agent_id format: ${idErr}` };
  return { ok: true, data: applyAgentDefaults(loadAgentConfig(agentId, opts)) };
}

function agentConfigGet(agentId, key, opts = {}) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: `invalid agent_id format: ${idErr}` };
  if (!Object.prototype.hasOwnProperty.call(AGENT_CONFIG_SCHEMA, key)) {
    return {
      ok: false,
      error: `unknown key '${key}'. Known keys: ${AGENT_CONFIG_KNOWN_KEYS.join(', ')}`,
    };
  }
  const view = applyAgentDefaults(loadAgentConfig(agentId, opts));
  const value = Object.prototype.hasOwnProperty.call(view, key) ? view[key] : null;
  return { ok: true, data: { key, value } };
}

function agentConfigSet(agentId, key, rawValue, opts = {}) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: `invalid agent_id format: ${idErr}` };
  const parsed = parseAgentValue(key, rawValue);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const stored = loadAgentConfig(agentId, opts);
  stored[key] = parsed.value;
  saveAgentConfig(agentId, stored, opts);
  return { ok: true, data: { key, value: parsed.value } };
}

function agentConfigUnset(agentId, key, opts = {}) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: `invalid agent_id format: ${idErr}` };
  if (!Object.prototype.hasOwnProperty.call(AGENT_CONFIG_SCHEMA, key)) {
    return {
      ok: false,
      error: `unknown key '${key}'. Known keys: ${AGENT_CONFIG_KNOWN_KEYS.join(', ')}`,
    };
  }
  const filePath = agentConfigPath(agentId, opts);
  if (!fs.existsSync(filePath)) {
    return { ok: true, data: { key, removed: false } };
  }
  const stored = loadAgentConfig(agentId, opts);
  let removed = false;
  if (Object.prototype.hasOwnProperty.call(stored, key)) {
    delete stored[key];
    removed = true;
  }
  saveAgentConfig(agentId, stored, opts);
  return { ok: true, data: { key, removed } };
}

// ---------------------------------------------------------------------------
// argv parser
// ---------------------------------------------------------------------------

/**
 * Parse argv into { command, sub, positional, flags } with a hand-rolled
 * scanner. Both `-a <agent_id>` and `--agent` (output flag) are short/long
 * variants of separate options — disambiguated by exact length and prefix.
 *
 * Returns { error?: string, ... } on parse failure (e.g. missing flag value).
 */
function parseArgv(argv) {
  // Known boolean flags (no value)
  const BOOL_FLAGS = new Set(['--agent', '--all', '--force']);
  // Known value-bearing flags (short or long)
  const VALUE_FLAGS = new Map([
    ['-u', 'user_id'],
    ['--user', 'user_id'],
    ['-a', 'agent_id'],
    ['--agent-id', 'agent_id'],
    ['-r', 'run_id'],
    ['--run-id', 'run_id'],
    ['--limit', 'limit'],
    ['--metadata', 'metadata'],
    ['--json-messages', 'json_messages'],
    ['--user-id', 'user_id_init'],
  ]);

  const flags = {};
  const positional = [];

  let i = 0;
  while (i < argv.length) {
    const tok = argv[i];

    if (BOOL_FLAGS.has(tok)) {
      // Map --agent (output) → flags.agent_output
      if (tok === '--agent') flags.agent_output = true;
      else if (tok === '--all') flags.all = true;
      else if (tok === '--force') flags.force = true;
      i += 1;
      continue;
    }

    if (VALUE_FLAGS.has(tok)) {
      const key = VALUE_FLAGS.get(tok);
      const val = argv[i + 1];
      if (val === undefined) {
        return { error: `missing value for ${tok}` };
      }
      flags[key] = val;
      i += 2;
      continue;
    }

    // unknown leading-dash tokens => surface as positional (so the command
    // handler can reject them with a clear error). We DO NOT silently swallow.
    positional.push(tok);
    i += 1;
  }

  // First positional is the command, second may be sub-command.
  const command = positional[0];
  const sub = positional[1];
  const rest = positional.slice(2);

  return { command, sub, rest, positional, flags };
}

// ---------------------------------------------------------------------------
// REST client
// ---------------------------------------------------------------------------

class RestClient {
  constructor(config, opts = {}) {
    this._config = config;
    this._fetch = opts.fetch || globalThis.fetch.bind(globalThis);
  }

  _url(urlPath) {
    const base = (this._config.rest_base_url || '').replace(/\/+$/, '');
    return `${base}${urlPath}`;
  }

  _headers() {
    return {
      Authorization: `Bearer ${this._config.rest_api_key || ''}`,
      'Content-Type': 'application/json',
    };
  }

  _timeoutMs(minMs) {
    const base = Math.floor(Number(this._config.search_timeout || DEFAULT_SEARCH_TIMEOUT_S) * 1000);
    return minMs ? Math.max(base, minMs) : base;
  }

  async _request(method, urlPath, { body, timeoutMs } = {}) {
    const url = this._url(urlPath);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const init = {
      method,
      headers: this._headers(),
      signal: controller.signal,
      redirect: 'follow',
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    let resp;
    try {
      resp = await this._fetch(url, init);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (controller.signal.aborted || /abort/i.test(msg)) {
        const secs = (timeoutMs / 1000).toFixed(0);
        throw new Error(`request timed out after ${secs}s`);
      }
      throw new Error(msg);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText || ''}`.trim());
    }

    // Parse JSON; fall back to {result: <text>} when body isn't JSON.
    let parsed;
    try {
      parsed = await resp.json();
    } catch (_) {
      try {
        parsed = { result: await resp.text() };
      } catch (_2) {
        parsed = { result: '' };
      }
    }
    return parsed;
  }

  async add({ messages, userId, agentId, runId, metadata }) {
    const body = { messages };
    if (userId) body.user_id = userId;
    if (agentId) body.agent_id = agentId;
    if (runId) body.run_id = runId;
    if (metadata) body.metadata = metadata;
    return this._request('POST', '/memories', {
      body,
      timeoutMs: this._timeoutMs(ADD_MIN_TIMEOUT_MS),
    });
  }

  async search({ query, userId, agentId, runId, limit }) {
    const body = { query };
    if (userId) body.user_id = userId;
    if (agentId) body.agent_id = agentId;
    if (runId) body.run_id = runId;
    const data = await this._request('POST', '/search', {
      body,
      timeoutMs: this._timeoutMs(),
    });
    let results;
    if (Array.isArray(data)) {
      results = data;
    } else if (data && typeof data === 'object') {
      results = data.results || [];
    } else {
      results = [];
    }
    return results.slice(0, limit);
  }

  async listAll({ userId, agentId, runId }) {
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (agentId) params.set('agent_id', agentId);
    if (runId) params.set('run_id', runId);
    const qs = params.toString();
    const data = await this._request('GET', `/memories${qs ? `?${qs}` : ''}`, {
      timeoutMs: this._timeoutMs(),
    });
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      return data.results || data.memories || [];
    }
    return [];
  }

  async deleteAll({ userId, agentId, runId }) {
    const params = new URLSearchParams();
    if (userId) params.set('user_id', userId);
    if (agentId) params.set('agent_id', agentId);
    if (runId) params.set('run_id', runId);
    const qs = params.toString();
    return this._request('DELETE', `/memories${qs ? `?${qs}` : ''}`, {
      timeoutMs: this._timeoutMs(),
    });
  }

  async health() {
    // Returns { ok: true, message } or throws. /health 404 is treated as
    // "endpoint absent but server reachable" by the caller.
    return this._request('GET', '/health', { timeoutMs: this._timeoutMs() });
  }
}

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function envelopeOk(command, data, scope, durationMs, count) {
  const env = {
    status: 'ok',
    command,
    duration_ms: durationMs,
    scope,
    data,
  };
  if (count !== undefined && count !== null) env.count = count;
  return env;
}

function envelopePending(command, data, scope, durationMs) {
  return {
    status: 'pending',
    command,
    duration_ms: durationMs,
    scope,
    data,
  };
}

function envelopeError(command, error) {
  return {
    status: 'error',
    command,
    error,
    data: null,
  };
}

function isPendingPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (typeof payload.status === 'string' && payload.status.toUpperCase() === 'PENDING') {
    return true;
  }
  if (Array.isArray(payload.results)) {
    for (const item of payload.results) {
      if (item && typeof item === 'object' && typeof item.status === 'string'
          && item.status.toUpperCase() === 'PENDING') {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Output sinks
// ---------------------------------------------------------------------------

/**
 * Encapsulates stdout/stderr writes so tests can capture them.
 */
function defaultIo() {
  return {
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  };
}

function writeJson(io, target, obj) {
  const text = JSON.stringify(obj) + '\n';
  if (target === 'stderr') io.stderr(text);
  else io.stdout(text);
}

function writeLine(io, target, line) {
  const text = line + (line.endsWith('\n') ? '' : '\n');
  if (target === 'stderr') io.stderr(text);
  else io.stdout(text);
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function buildScope(flags, config) {
  const hasExplicit =
    flags.user_id != null || flags.agent_id != null || flags.run_id != null;
  let userId;
  if (flags.user_id != null) userId = flags.user_id;
  else if (!hasExplicit) userId = (config && config.user_id) || 'default';
  else userId = '';
  return {
    user_id: userId,
    agent_id: flags.agent_id || '',
    run_id: flags.run_id || '',
  };
}

async function cmdAdd(parsed, ctx) {
  const t0 = Date.now();
  const { config, source, configError, io, flags } = ctx;

  if (configError) {
    return emitError(io, flags, 'add', configError);
  }

  // messages — for `add "<text>"`, the text is positional[1] (parsed.sub)
  let messages;
  if (flags.json_messages) {
    try {
      const parsedJson = JSON.parse(flags.json_messages);
      if (!Array.isArray(parsedJson)) {
        return emitError(io, flags, 'add', 'JSON messages must be an array');
      }
      messages = parsedJson;
    } catch (e) {
      return emitError(io, flags, 'add', `Invalid JSON: ${e.message}`);
    }
  } else if (parsed.sub !== undefined && parsed.sub !== '') {
    messages = [{ role: 'user', content: parsed.sub }];
  } else {
    return emitError(io, flags, 'add', "No input provided. Pass text or --json-messages.");
  }

  let metadata = null;
  if (flags.metadata) {
    try {
      metadata = JSON.parse(flags.metadata);
    } catch (e) {
      return emitError(io, flags, 'add', `Invalid metadata JSON: ${e.message}`);
    }
  }

  const scope = buildScope(flags, config);
  try {
    const client = new RestClient(config, { fetch: ctx.fetch });
    const result = await client.add({
      messages,
      userId: scope.user_id || undefined,
      agentId: scope.agent_id || undefined,
      runId: scope.run_id || undefined,
      metadata,
    });
    const durationMs = Date.now() - t0;
    if (isPendingPayload(result)) {
      return emit(io, flags, 'add', envelopePending('add', result, scope, durationMs), {
        humanLine: 'add: PENDING (asynchronous write submitted).',
      });
    }
    return emit(io, flags, 'add', envelopeOk('add', result, scope, durationMs), {
      humanText: () => prettyJson(result),
    });
  } catch (e) {
    return emitError(io, flags, 'add', e.message || String(e));
  }
}

async function cmdSearch(parsed, ctx) {
  const t0 = Date.now();
  const { config, configError, io, flags } = ctx;
  if (configError) return emitError(io, flags, 'search', configError);

  // For `search "<query>"`, query lives at positional[1] (parsed.sub).
  const query = parsed.sub;
  if (!query) return emitError(io, flags, 'search', 'search requires <query>');

  const limit = flags.limit != null ? parseInt(flags.limit, 10) || 5 : 5;
  const scope = buildScope(flags, config);

  try {
    const client = new RestClient(config, { fetch: ctx.fetch });
    const results = await client.search({
      query,
      userId: scope.user_id || undefined,
      agentId: scope.agent_id || undefined,
      runId: scope.run_id || undefined,
      limit,
    });
    const durationMs = Date.now() - t0;
    return emit(
      io,
      flags,
      'search',
      envelopeOk('search', results, scope, durationMs, results.length),
      {
        humanText: () =>
          results.length === 0 ? 'No matching memories found.' : prettyJson(results),
      }
    );
  } catch (e) {
    return emitError(io, flags, 'search', e.message || String(e));
  }
}

async function cmdList(parsed, ctx) {
  const t0 = Date.now();
  const { config, configError, io, flags } = ctx;
  if (configError) return emitError(io, flags, 'list', configError);

  const scope = buildScope(flags, config);
  try {
    const client = new RestClient(config, { fetch: ctx.fetch });
    const results = await client.listAll({
      userId: scope.user_id || undefined,
      agentId: scope.agent_id || undefined,
      runId: scope.run_id || undefined,
    });
    const durationMs = Date.now() - t0;
    return emit(
      io,
      flags,
      'list',
      envelopeOk('list', results, scope, durationMs, results.length),
      {
        humanText: () =>
          results.length === 0 ? 'No memories found for this scope.' : prettyJson(results),
      }
    );
  } catch (e) {
    return emitError(io, flags, 'list', e.message || String(e));
  }
}

async function cmdDelete(parsed, ctx) {
  const t0 = Date.now();
  const { config, configError, io, flags } = ctx;
  if (configError) return emitError(io, flags, 'delete', configError);

  if (!flags.all) return emitError(io, flags, 'delete', 'delete requires --all');
  if (!flags.user_id) return emitError(io, flags, 'delete', 'delete --all requires -u <user>');
  if (!flags.force) return emitError(io, flags, 'delete', 'delete --all requires --force in non-interactive mode');

  const scope = buildScope(flags, config);
  try {
    const client = new RestClient(config, { fetch: ctx.fetch });
    const result = await client.deleteAll({
      userId: scope.user_id || undefined,
      agentId: scope.agent_id || undefined,
      runId: scope.run_id || undefined,
    });
    const durationMs = Date.now() - t0;
    return emit(io, flags, 'delete', envelopeOk('delete', result, scope, durationMs), {
      humanText: () => prettyJson(result),
    });
  } catch (e) {
    return emitError(io, flags, 'delete', e.message || String(e));
  }
}

async function cmdStatus(parsed, ctx) {
  const t0 = Date.now();
  const { config, configError, io, flags } = ctx;
  if (configError) return emitError(io, flags, 'status', configError);

  const scope = buildScope(flags, config);
  try {
    const client = new RestClient(config, { fetch: ctx.fetch });
    let payload;
    try {
      payload = await client.health();
    } catch (e) {
      // 404 → endpoint absent but treat as ok with note
      const msg = e.message || String(e);
      if (/HTTP 404/.test(msg)) {
        const durationMs = Date.now() - t0;
        return emit(
          io,
          flags,
          'status',
          envelopeOk(
            'status',
            { connected: true, message: 'no /health endpoint exposed (404), but server reachable' },
            scope,
            durationMs
          ),
          { humanText: () => 'status: ok (no /health endpoint, but server reachable)' }
        );
      }
      throw e;
    }
    const durationMs = Date.now() - t0;
    return emit(
      io,
      flags,
      'status',
      envelopeOk(
        'status',
        { connected: true, message: `REST API ${config.rest_base_url}`, raw: payload },
        scope,
        durationMs
      ),
      { humanText: () => `status: ok — ${config.rest_base_url}` }
    );
  } catch (e) {
    return emitError(io, flags, 'status', e.message || String(e));
  }
}

// ---------------------------------------------------------------------------
// Config sub-commands
// ---------------------------------------------------------------------------

function cmdConfigInit(parsed, ctx) {
  const { io, flags } = ctx;
  const url = parsed.rest[0];
  const key = parsed.rest[1];
  if (!url || !key) {
    return emitError(
      io,
      flags,
      'config-init',
      'config init <rest_base_url> <rest_api_key>'
    );
  }
  const userId = flags.user_id_init || 'default';
  let absPath;
  try {
    absPath = saveConfigAtCwd(url, key, userId, { cwd: ctx.cwd });
  } catch (e) {
    return emitError(io, flags, 'config-init', `failed to write config: ${e.message}`);
  }
  const t0Ok = Date.now();
  if (flags.agent_output) {
    writeJson(io, 'stdout', {
      status: 'ok',
      command: 'config-init',
      duration_ms: 0,
      scope: { user_id: userId, agent_id: '', run_id: '' },
      data: { path: absPath, user_id: userId },
    });
  } else {
    writeLine(io, 'stdout', `Config written to ${absPath}`);
  }
  // touch t0Ok to silence linters
  void t0Ok;
  return 0;
}

function cmdConfigShow(parsed, ctx) {
  const { config, source, configError, io, flags } = ctx;
  if (configError) return emitError(io, flags, 'config-show', configError);
  const masked = maskedConfigView(config);
  const data = { ...masked, source };
  if (flags.agent_output) {
    writeJson(io, 'stdout', {
      status: 'ok',
      command: 'config-show',
      duration_ms: 0,
      scope: buildScope(flags, config),
      data,
    });
  } else {
    writeLine(io, 'stdout', prettyJson(data));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// agent-config sub-commands
// ---------------------------------------------------------------------------

function emitAgentConfigOk(io, flags, action, agentId, data, durationMs) {
  const command = `agent-config-${action}`;
  if (flags.agent_output) {
    writeJson(io, 'stdout', {
      status: 'ok',
      command,
      duration_ms: durationMs,
      agent_id: agentId,
      data,
    });
    return 0;
  }
  if (action === 'show') {
    writeLine(io, 'stdout', JSON.stringify(data, null, 2));
  } else if (action === 'get') {
    const v = data.value;
    writeLine(io, 'stdout', v === null || v === undefined ? '' : (typeof v === 'string' ? v : JSON.stringify(v)));
  } else if (action === 'set') {
    writeLine(io, 'stdout', `Set '${data.key}' = ${JSON.stringify(data.value)} for agent ${agentId}`);
  } else if (action === 'unset') {
    writeLine(
      io,
      'stdout',
      data.removed
        ? `Unset '${data.key}' for agent ${agentId}`
        : `Key '${data.key}' was not set for agent ${agentId}`
    );
  }
  return 0;
}

function emitAgentConfigError(io, flags, action, error) {
  const command = `agent-config-${action}`;
  if (flags.agent_output) {
    writeJson(io, 'stderr', { status: 'error', command, error, data: null });
  } else {
    writeLine(io, 'stderr', `Error: ${error}`);
  }
  return 2;
}

function requireAgentId(flags, action, io) {
  if (!flags.agent_id) {
    return { exit: emitAgentConfigError(io, flags, action, 'agent-config commands require -a <agent_id>') };
  }
  return { agentId: flags.agent_id };
}

function cmdAgentConfig(parsed, ctx) {
  const { io, flags } = ctx;
  const action = parsed.sub;
  if (!['show', 'get', 'set', 'unset'].includes(action)) {
    return emitAgentConfigError(io, flags, action || '?', `unknown agent-config subcommand '${action || ''}'. Try: show | get | set | unset`);
  }
  const req = requireAgentId(flags, action, io);
  if (req.exit !== undefined) return req.exit;
  const agentId = req.agentId;

  const t0 = Date.now();
  const opts = { cwd: ctx.cwd };
  if (action === 'show') {
    const r = agentConfigShow(agentId, opts);
    if (!r.ok) return emitAgentConfigError(io, flags, 'show', r.error);
    return emitAgentConfigOk(io, flags, 'show', agentId, r.data, Date.now() - t0);
  }
  if (action === 'get') {
    const key = parsed.rest[0];
    if (!key) return emitAgentConfigError(io, flags, 'get', 'agent-config get <key>');
    const r = agentConfigGet(agentId, key, opts);
    if (!r.ok) return emitAgentConfigError(io, flags, 'get', r.error);
    return emitAgentConfigOk(io, flags, 'get', agentId, r.data, Date.now() - t0);
  }
  if (action === 'set') {
    const key = parsed.rest[0];
    const value = parsed.rest[1];
    if (key === undefined || value === undefined) {
      return emitAgentConfigError(io, flags, 'set', 'agent-config set <key> <value>');
    }
    const r = agentConfigSet(agentId, key, value, opts);
    if (!r.ok) return emitAgentConfigError(io, flags, 'set', r.error);
    return emitAgentConfigOk(io, flags, 'set', agentId, r.data, Date.now() - t0);
  }
  if (action === 'unset') {
    const key = parsed.rest[0];
    if (!key) return emitAgentConfigError(io, flags, 'unset', 'agent-config unset <key>');
    const r = agentConfigUnset(agentId, key, opts);
    if (!r.ok) return emitAgentConfigError(io, flags, 'unset', r.error);
    return emitAgentConfigOk(io, flags, 'unset', agentId, r.data, Date.now() - t0);
  }
  // unreachable
  return 2;
}

// ---------------------------------------------------------------------------
// Emit helpers (top-level commands)
// ---------------------------------------------------------------------------

function emit(io, flags, command, envelope, humanOpts = {}) {
  if (flags.agent_output) {
    writeJson(io, 'stdout', envelope);
    return 0;
  }
  // human text
  if (envelope.status === 'pending' && humanOpts.humanLine) {
    writeLine(io, 'stdout', humanOpts.humanLine);
  } else if (humanOpts.humanText) {
    writeLine(io, 'stdout', humanOpts.humanText());
  } else {
    writeLine(io, 'stdout', prettyJson(envelope.data));
  }
  return 0;
}

function emitError(io, flags, command, error) {
  if (flags.agent_output) {
    writeJson(io, 'stderr', envelopeError(command, error));
  } else {
    writeLine(io, 'stderr', `Error: ${error}`);
  }
  return 1;
}

function prettyJson(v) {
  if (typeof v === 'string') return v;
  return JSON.stringify(v, null, 2);
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

const HELP = `Usage:
  adbpg-mem.mjs <command> [options]

Commands:
  add "<text>" [-u user] [-a agent] [-r run] [--metadata json] [--json-messages json] [--agent]
  search "<query>" [-u user] [-a agent] [-r run] [--limit N] [--agent]
  list [-u user] [-a agent] [-r run] [--agent]
  delete --all -u <user> --force [--agent]
  status [--agent]
  agent-config show|get|set|unset -a <agent_id> [...] [--agent]
  config init <rest_base_url> <rest_api_key> [--user-id <id>]
  config show [--agent]

Config resolution (in order):
  1. env: ADBPG_REST_BASE_URL + ADBPG_REST_API_KEY (+ ADBPG_USER_ID, ADBPG_SEARCH_TIMEOUT)
  2. <cwd>/.adbpg-mem/config.json
  3. <home>/.adbpg-mem/config.json
`;

/**
 * Run the CLI. Exposed for testing — pass `argv` and optional ctx overrides
 * (io, fetch, cwd, env, homedir). Returns the exit code (number).
 */
export async function run(argv, ctxOverrides = {}) {
  const io = ctxOverrides.io || defaultIo();
  const cwd = ctxOverrides.cwd || process.cwd();

  const parsed = parseArgv(argv);
  if (parsed.error) {
    if (parsed.flags && parsed.flags.agent_output) {
      writeJson(io, 'stderr', envelopeError('parse', parsed.error));
    } else {
      writeLine(io, 'stderr', `Error: ${parsed.error}`);
    }
    return 2;
  }

  const flags = parsed.flags;
  const command = parsed.command;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    writeLine(io, 'stdout', HELP);
    return command ? 0 : 2;
  }

  // config init must run BEFORE we attempt to load config (used to bootstrap).
  if (command === 'config' && parsed.sub === 'init') {
    return cmdConfigInit({ ...parsed, rest: parsed.positional.slice(2) }, {
      io,
      flags,
      cwd,
    });
  }

  // Load config once, share across commands.
  const { config, source } = loadConfig({
    env: ctxOverrides.env || process.env,
    cwd,
    homedir: ctxOverrides.homedir || os.homedir(),
  });
  const configError = config ? null : configMissingMessage();

  const ctx = {
    io,
    flags,
    cwd,
    fetch: ctxOverrides.fetch,
    config,
    source,
    configError,
  };

  switch (command) {
    case 'add':
      return cmdAdd(parsed, ctx);
    case 'search':
      return cmdSearch(parsed, ctx);
    case 'list':
      return cmdList(parsed, ctx);
    case 'delete':
      return cmdDelete(parsed, ctx);
    case 'status':
      return cmdStatus(parsed, ctx);
    case 'config': {
      if (parsed.sub === 'show') {
        return cmdConfigShow({ ...parsed, rest: parsed.positional.slice(2) }, ctx);
      }
      return emitError(io, flags, 'config', `unknown config subcommand '${parsed.sub || ''}'. Try: init | show`);
    }
    case 'agent-config':
      return cmdAgentConfig({ ...parsed, rest: parsed.positional.slice(2) }, ctx);
    default:
      if (flags.agent_output) {
        writeJson(io, 'stderr', envelopeError(command, `unknown command '${command}'`));
      } else {
        writeLine(io, 'stderr', `Error: unknown command '${command}'`);
        writeLine(io, 'stderr', HELP);
      }
      return 2;
  }
}

// Also export the internal pieces so the test file can exercise them in isolation.
export const __test = {
  parseArgv,
  loadConfig,
  saveConfigAtCwd,
  maskValue,
  maskedConfigView,
  configMissingMessage,
  validateAgentId,
  agentConfigShow,
  agentConfigGet,
  agentConfigSet,
  agentConfigUnset,
  parseAgentValue,
  buildScope,
  isPendingPayload,
  RestClient,
  envelopeOk,
  envelopePending,
  envelopeError,
};

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code || 0),
    (e) => {
      process.stderr.write(`Fatal: ${e && e.message ? e.message : String(e)}\n`);
      process.exit(2);
    }
  );
}
