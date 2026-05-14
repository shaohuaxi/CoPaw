'use strict';

/**
 * Per-agent configuration management.
 *
 * Each agent has its own JSON file at ~/.adbpg-mem/agents/<agent_id>.json
 * with mode 0600. Schema:
 *   - isolation_agent: boolean (default: false)
 *   - isolation_run_mode: enum ["off", "manual", "auto", "tag"] (default: "off")
 *   - current_run_id: string (optional, no default)
 *
 * Defaults are applied at read time when a key is absent. They are NOT
 * persisted to disk on first set — only explicitly-set keys are written.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const AGENTS_DIR = path.join(os.homedir(), '.adbpg-mem', 'agents');

const ISOLATION_RUN_MODES = ['off', 'manual', 'auto', 'tag'];

// Field schema: type + default (default of `undefined` means "no default — omit from show")
const SCHEMA = {
  isolation_agent: {
    type: 'boolean',
    default: false,
  },
  isolation_run_mode: {
    type: 'enum',
    values: ISOLATION_RUN_MODES,
    default: 'off',
  },
  current_run_id: {
    type: 'string',
    // No default; absent from show output when unset.
  },
};

const KNOWN_KEYS = Object.keys(SCHEMA);

// agent_id: 1-64 chars, [a-zA-Z0-9_-]
const AGENT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validate the agent_id format. Returns null if valid, else an error message.
 * @param {*} agentId
 * @returns {string|null}
 */
function validateAgentId(agentId) {
  if (agentId === undefined || agentId === null || agentId === '') {
    return 'agent_id is required';
  }
  if (typeof agentId !== 'string') {
    return 'agent_id must be a string';
  }
  if (agentId.length > 64) {
    return 'agent_id exceeds 64 characters';
  }
  if (!AGENT_ID_RE.test(agentId)) {
    return 'agent_id must match [a-zA-Z0-9_-] and be 1-64 chars';
  }
  return null;
}

/**
 * Resolve the on-disk path for a given agent_id under a base directory.
 * @param {string} agentId
 * @param {string} [baseDir] - Defaults to AGENTS_DIR.
 * @returns {string}
 */
function agentConfigPath(agentId, baseDir) {
  const dir = baseDir != null ? baseDir : AGENTS_DIR;
  return path.join(dir, `${agentId}.json`);
}

/**
 * Load raw stored config for an agent. Returns {} if file missing.
 * @param {string} agentId
 * @param {string} [baseDir]
 * @returns {object}
 */
function loadAgentConfig(agentId, baseDir) {
  const filePath = agentConfigPath(agentId, baseDir);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Persist agent config to disk with 0600 perms. Creates the agents dir
 * (with default perms) on demand. Atomically rewrites the file each time.
 * @param {string} agentId
 * @param {object} config
 * @param {string} [baseDir]
 */
function saveAgentConfig(agentId, config, baseDir) {
  const filePath = agentConfigPath(agentId, baseDir);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 });
  // Ensure perms even when file pre-existed with looser mode.
  try {
    fs.chmodSync(filePath, 0o600);
  } catch (_) {
    // best-effort
  }
}

/**
 * Remove an agent's config file. No-op if missing.
 * @param {string} agentId
 * @param {string} [baseDir]
 */
function removeAgentConfig(agentId, baseDir) {
  const filePath = agentConfigPath(agentId, baseDir);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Build the effective view of an agent's config: stored values overlaid on
 * schema defaults. Fields without a default and without a stored value
 * are omitted (not surfaced as null/undefined).
 * @param {object} stored
 * @returns {object}
 */
function applyDefaults(stored) {
  const out = {};
  for (const [key, def] of Object.entries(SCHEMA)) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) {
      out[key] = stored[key];
    } else if (def.default !== undefined) {
      out[key] = def.default;
    }
  }
  return out;
}

/**
 * Parse and validate a CLI-supplied string value for a known key.
 * Returns { ok: true, value } or { ok: false, error }.
 *
 * Boolean parsing accepts: true/false (case-insensitive). Anything else errors.
 * Enum parsing requires exact match against the allowed set.
 * String parsing passes the value through unchanged (length>0 enforced for
 * current_run_id since empty would be indistinguishable from "unset" intent).
 *
 * @param {string} key
 * @param {string} rawValue
 * @returns {{ ok: boolean, value?: any, error?: string }}
 */
function parseValue(key, rawValue) {
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) {
    return { ok: false, error: `unknown key '${key}'. Known keys: ${KNOWN_KEYS.join(', ')}` };
  }
  const def = SCHEMA[key];

  if (def.type === 'boolean') {
    if (typeof rawValue !== 'string') {
      return { ok: false, error: `invalid value for ${key}: expected boolean string, got ${typeof rawValue}` };
    }
    const lowered = rawValue.toLowerCase();
    if (lowered === 'true') return { ok: true, value: true };
    if (lowered === 'false') return { ok: true, value: false };
    return { ok: false, error: `invalid value for ${key}: expected 'true' or 'false', got '${rawValue}'` };
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

  // Defensive — schema only defines the three types above.
  return { ok: false, error: `invalid value for ${key}: unsupported type` };
}

/**
 * High-level operations used by the CLI layer. Each returns
 * { ok: true, data } or { ok: false, error }. The caller is responsible
 * for shaping the JSON envelope / text output.
 */

function opShow(agentId, baseDir) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: invalidIdMsg(idErr) };
  const stored = loadAgentConfig(agentId, baseDir);
  return { ok: true, data: applyDefaults(stored) };
}

function opGet(agentId, key, baseDir) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: invalidIdMsg(idErr) };
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) {
    return { ok: false, error: `unknown key '${key}'. Known keys: ${KNOWN_KEYS.join(', ')}` };
  }
  const view = applyDefaults(loadAgentConfig(agentId, baseDir));
  // current_run_id may legitimately be absent — surface as null in the data shape.
  const value = Object.prototype.hasOwnProperty.call(view, key) ? view[key] : null;
  return { ok: true, data: { key, value } };
}

function opSet(agentId, key, rawValue, baseDir) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: invalidIdMsg(idErr) };
  const parsed = parseValue(key, rawValue);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const stored = loadAgentConfig(agentId, baseDir);
  stored[key] = parsed.value;
  saveAgentConfig(agentId, stored, baseDir);
  return { ok: true, data: { key, value: parsed.value } };
}

function opUnset(agentId, key, baseDir) {
  const idErr = validateAgentId(agentId);
  if (idErr) return { ok: false, error: invalidIdMsg(idErr) };
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, key)) {
    return { ok: false, error: `unknown key '${key}'. Known keys: ${KNOWN_KEYS.join(', ')}` };
  }
  const filePath = agentConfigPath(agentId, baseDir);
  if (!fs.existsSync(filePath)) {
    // Idempotent: nothing to unset.
    return { ok: true, data: { key, removed: false } };
  }
  const stored = loadAgentConfig(agentId, baseDir);
  let removed = false;
  if (Object.prototype.hasOwnProperty.call(stored, key)) {
    delete stored[key];
    removed = true;
  }
  saveAgentConfig(agentId, stored, baseDir);
  return { ok: true, data: { key, removed } };
}

function invalidIdMsg(detail) {
  return `invalid agent_id format: ${detail}`;
}

module.exports = {
  AGENTS_DIR,
  ISOLATION_RUN_MODES,
  SCHEMA,
  KNOWN_KEYS,
  AGENT_ID_RE,
  validateAgentId,
  agentConfigPath,
  loadAgentConfig,
  saveAgentConfig,
  removeAgentConfig,
  applyDefaults,
  parseValue,
  opShow,
  opGet,
  opSet,
  opUnset,
};
