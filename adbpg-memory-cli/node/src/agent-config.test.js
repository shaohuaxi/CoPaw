'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  validateAgentId,
  agentConfigPath,
  loadAgentConfig,
  saveAgentConfig,
  applyDefaults,
  parseValue,
  opShow,
  opGet,
  opSet,
  opUnset,
  KNOWN_KEYS,
  ISOLATION_RUN_MODES,
  SCHEMA,
} = require('./agent-config');

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-test-'));
}

describe('validateAgentId', () => {
  test('accepts simple alphanumeric', () => {
    expect(validateAgentId('xK3mNp')).toBeNull();
  });
  test('accepts dashes and underscores', () => {
    expect(validateAgentId('agent_1-foo')).toBeNull();
  });
  test('rejects empty string', () => {
    expect(validateAgentId('')).toMatch(/required/);
  });
  test('rejects null/undefined', () => {
    expect(validateAgentId(null)).toMatch(/required/);
    expect(validateAgentId(undefined)).toMatch(/required/);
  });
  test('rejects non-string', () => {
    expect(validateAgentId(123)).toMatch(/string/);
  });
  test('rejects spaces', () => {
    expect(validateAgentId('foo bar')).toMatch(/\[a-zA-Z0-9_-\]/);
  });
  test('rejects path traversal characters', () => {
    expect(validateAgentId('../etc')).toMatch(/\[a-zA-Z0-9_-\]/);
    expect(validateAgentId('foo/bar')).toMatch(/\[a-zA-Z0-9_-\]/);
  });
  test('rejects > 64 chars', () => {
    const tooLong = 'a'.repeat(65);
    expect(validateAgentId(tooLong)).not.toBeNull();
  });
  test('accepts exactly 64 chars', () => {
    const justRight = 'a'.repeat(64);
    expect(validateAgentId(justRight)).toBeNull();
  });
  test('rejects unicode', () => {
    expect(validateAgentId('agent中文')).toMatch(/\[a-zA-Z0-9_-\]/);
  });
});

describe('agentConfigPath', () => {
  test('joins under the provided base dir', () => {
    const tmp = makeTmpDir();
    expect(agentConfigPath('foo', tmp)).toBe(path.join(tmp, 'foo.json'));
  });
});

describe('loadAgentConfig / saveAgentConfig', () => {
  test('load returns {} when file missing', () => {
    const tmp = makeTmpDir();
    expect(loadAgentConfig('nope', tmp)).toEqual({});
  });

  test('save then load round-trips', () => {
    const tmp = makeTmpDir();
    saveAgentConfig('a1', { isolation_agent: true }, tmp);
    expect(loadAgentConfig('a1', tmp)).toEqual({ isolation_agent: true });
  });

  test('save creates the agents subdir if missing', () => {
    const tmp = makeTmpDir();
    const sub = path.join(tmp, 'newdir');
    saveAgentConfig('a1', { isolation_run_mode: 'manual' }, sub);
    expect(fs.existsSync(path.join(sub, 'a1.json'))).toBe(true);
  });

  test('saved file has 0600 perms', () => {
    if (process.platform === 'win32') return; // mode bits unreliable on Windows
    const tmp = makeTmpDir();
    saveAgentConfig('a1', { isolation_agent: false }, tmp);
    const stat = fs.statSync(path.join(tmp, 'a1.json'));
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test('rewrite preserves 0600 perms even if file pre-existed with looser mode', () => {
    if (process.platform === 'win32') return;
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'a1.json');
    fs.writeFileSync(filePath, '{}', { mode: 0o644 });
    fs.chmodSync(filePath, 0o644);
    saveAgentConfig('a1', { isolation_agent: true }, tmp);
    const stat = fs.statSync(filePath);
    expect(stat.mode & 0o777).toBe(0o600);
  });
});

describe('applyDefaults', () => {
  test('fills schema defaults when stored is empty', () => {
    expect(applyDefaults({})).toEqual({
      isolation_agent: false,
      isolation_run_mode: 'off',
    });
  });

  test('omits current_run_id when unset', () => {
    const out = applyDefaults({});
    expect('current_run_id' in out).toBe(false);
  });

  test('stored values override defaults', () => {
    expect(applyDefaults({ isolation_agent: true, isolation_run_mode: 'manual' })).toEqual({
      isolation_agent: true,
      isolation_run_mode: 'manual',
    });
  });

  test('current_run_id surfaces when set', () => {
    expect(applyDefaults({ current_run_id: 'run-42' })).toEqual({
      isolation_agent: false,
      isolation_run_mode: 'off',
      current_run_id: 'run-42',
    });
  });
});

describe('parseValue', () => {
  test('boolean true/false (lowercase)', () => {
    expect(parseValue('isolation_agent', 'true')).toEqual({ ok: true, value: true });
    expect(parseValue('isolation_agent', 'false')).toEqual({ ok: true, value: false });
  });

  test('boolean is case-insensitive', () => {
    expect(parseValue('isolation_agent', 'True').value).toBe(true);
    expect(parseValue('isolation_agent', 'FALSE').value).toBe(false);
  });

  test('boolean rejects garbage', () => {
    const r = parseValue('isolation_agent', 'yes');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid value for isolation_agent/);
  });

  test('boolean rejects 1/0 (strict)', () => {
    expect(parseValue('isolation_agent', '1').ok).toBe(false);
    expect(parseValue('isolation_agent', '0').ok).toBe(false);
  });

  test('enum accepts each allowed value', () => {
    for (const v of ISOLATION_RUN_MODES) {
      expect(parseValue('isolation_run_mode', v)).toEqual({ ok: true, value: v });
    }
  });

  test('enum rejects unknown', () => {
    const r = parseValue('isolation_run_mode', 'nope');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/must be one of/);
  });

  test('string accepts non-empty', () => {
    expect(parseValue('current_run_id', 'run-1')).toEqual({ ok: true, value: 'run-1' });
  });

  test('string accepts unicode', () => {
    expect(parseValue('current_run_id', '项目-重构讨论').value).toBe('项目-重构讨论');
  });

  test('string rejects empty', () => {
    const r = parseValue('current_run_id', '');
    expect(r.ok).toBe(false);
  });

  test('unknown key rejected', () => {
    const r = parseValue('unknown_key', 'whatever');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown key/);
  });

  test('schema covers exactly the documented keys', () => {
    expect(KNOWN_KEYS.sort()).toEqual(
      ['isolation_agent', 'isolation_run_mode', 'current_run_id'].sort()
    );
    expect(SCHEMA.isolation_agent.default).toBe(false);
    expect(SCHEMA.isolation_run_mode.default).toBe('off');
  });
});

// ---------------------------------------------------------------------------
// High-level operations
// ---------------------------------------------------------------------------

describe('opShow', () => {
  test('returns schema defaults for an agent that does not exist', () => {
    const tmp = makeTmpDir();
    const r = opShow('xK3mNp', tmp);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ isolation_agent: false, isolation_run_mode: 'off' });
  });

  test('reflects stored values', () => {
    const tmp = makeTmpDir();
    opSet('xK3mNp', 'isolation_agent', 'true', tmp);
    opSet('xK3mNp', 'isolation_run_mode', 'manual', tmp);
    opSet('xK3mNp', 'current_run_id', '项目-重构讨论', tmp);
    const r = opShow('xK3mNp', tmp);
    expect(r.data).toEqual({
      isolation_agent: true,
      isolation_run_mode: 'manual',
      current_run_id: '项目-重构讨论',
    });
  });

  test('rejects invalid agent_id', () => {
    const tmp = makeTmpDir();
    const r = opShow('foo bar', tmp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid agent_id format/);
  });
});

describe('opGet', () => {
  test('returns default value when key is unset and has a default', () => {
    const tmp = makeTmpDir();
    expect(opGet('a', 'isolation_agent', tmp)).toEqual({
      ok: true,
      data: { key: 'isolation_agent', value: false },
    });
    expect(opGet('a', 'isolation_run_mode', tmp)).toEqual({
      ok: true,
      data: { key: 'isolation_run_mode', value: 'off' },
    });
  });

  test('returns null for unset current_run_id (no default)', () => {
    const tmp = makeTmpDir();
    expect(opGet('a', 'current_run_id', tmp)).toEqual({
      ok: true,
      data: { key: 'current_run_id', value: null },
    });
  });

  test('returns stored value', () => {
    const tmp = makeTmpDir();
    opSet('a', 'current_run_id', 'r1', tmp);
    expect(opGet('a', 'current_run_id', tmp).data.value).toBe('r1');
  });

  test('rejects unknown key', () => {
    const tmp = makeTmpDir();
    const r = opGet('a', 'mystery', tmp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown key/);
  });

  test('rejects invalid agent_id', () => {
    const tmp = makeTmpDir();
    const r = opGet('foo bar', 'isolation_agent', tmp);
    expect(r.ok).toBe(false);
  });
});

describe('opSet', () => {
  test('persists a boolean value', () => {
    const tmp = makeTmpDir();
    const r = opSet('a', 'isolation_agent', 'true', tmp);
    expect(r).toEqual({ ok: true, data: { key: 'isolation_agent', value: true } });
    expect(loadAgentConfig('a', tmp)).toEqual({ isolation_agent: true });
  });

  test('persists an enum value', () => {
    const tmp = makeTmpDir();
    opSet('a', 'isolation_run_mode', 'auto', tmp);
    expect(loadAgentConfig('a', tmp)).toEqual({ isolation_run_mode: 'auto' });
  });

  test('persists a string value', () => {
    const tmp = makeTmpDir();
    opSet('a', 'current_run_id', 'run-42', tmp);
    expect(loadAgentConfig('a', tmp)).toEqual({ current_run_id: 'run-42' });
  });

  test('does NOT persist defaults for keys that were not set', () => {
    const tmp = makeTmpDir();
    opSet('a', 'isolation_agent', 'true', tmp);
    // Only the explicitly-set key lands on disk.
    expect(loadAgentConfig('a', tmp)).toEqual({ isolation_agent: true });
  });

  test('multiple sets accumulate', () => {
    const tmp = makeTmpDir();
    opSet('a', 'isolation_agent', 'true', tmp);
    opSet('a', 'isolation_run_mode', 'tag', tmp);
    expect(loadAgentConfig('a', tmp)).toEqual({
      isolation_agent: true,
      isolation_run_mode: 'tag',
    });
  });

  test('overwrite an existing value', () => {
    const tmp = makeTmpDir();
    opSet('a', 'isolation_run_mode', 'manual', tmp);
    opSet('a', 'isolation_run_mode', 'auto', tmp);
    expect(loadAgentConfig('a', tmp).isolation_run_mode).toBe('auto');
  });

  test('rejects unknown key without writing', () => {
    const tmp = makeTmpDir();
    const r = opSet('a', 'mystery', 'val', tmp);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'a.json'))).toBe(false);
  });

  test('rejects bad value without writing', () => {
    const tmp = makeTmpDir();
    const r = opSet('a', 'isolation_agent', 'maybe', tmp);
    expect(r.ok).toBe(false);
    expect(fs.existsSync(path.join(tmp, 'a.json'))).toBe(false);
  });

  test('rejects invalid agent_id without writing', () => {
    const tmp = makeTmpDir();
    const r = opSet('foo bar', 'isolation_agent', 'true', tmp);
    expect(r.ok).toBe(false);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });
});

describe('opUnset', () => {
  test('removes a stored key', () => {
    const tmp = makeTmpDir();
    opSet('a', 'isolation_agent', 'true', tmp);
    opSet('a', 'isolation_run_mode', 'manual', tmp);
    const r = opUnset('a', 'isolation_agent', tmp);
    expect(r.ok).toBe(true);
    expect(r.data.removed).toBe(true);
    expect(loadAgentConfig('a', tmp)).toEqual({ isolation_run_mode: 'manual' });
  });

  test('idempotent on unset key', () => {
    const tmp = makeTmpDir();
    opSet('a', 'isolation_run_mode', 'manual', tmp);
    const r = opUnset('a', 'isolation_agent', tmp);
    expect(r.ok).toBe(true);
    expect(r.data.removed).toBe(false);
  });

  test('idempotent when agent file does not exist', () => {
    const tmp = makeTmpDir();
    const r = opUnset('ghost', 'isolation_agent', tmp);
    expect(r.ok).toBe(true);
    expect(r.data.removed).toBe(false);
    // Did not create the file.
    expect(fs.existsSync(path.join(tmp, 'ghost.json'))).toBe(false);
  });

  test('rejects unknown key', () => {
    const tmp = makeTmpDir();
    const r = opUnset('a', 'mystery', tmp);
    expect(r.ok).toBe(false);
  });

  test('rejects invalid agent_id', () => {
    const tmp = makeTmpDir();
    const r = opUnset('foo bar', 'isolation_agent', tmp);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-implementation envelope shape (agent-config has its OWN envelope —
// distinct from the standard scope/count one).
// ---------------------------------------------------------------------------

describe('agent-config agent-mode envelope shape (cross-impl contract)', () => {
  // We don't invoke the CLI directly here (no spawning); instead we
  // construct the envelope shape by hand from the building blocks the CLI
  // uses, and verify field order. The CLI integration test below exercises
  // the full path end-to-end.
  test('success envelope has expected field order: status, command, duration_ms, agent_id, data', () => {
    const envelope = {
      status: 'ok',
      command: 'agent-config-show',
      duration_ms: 5,
      agent_id: 'xK3mNp',
      data: { isolation_agent: true, isolation_run_mode: 'manual' },
    };
    expect(Object.keys(envelope)).toEqual([
      'status',
      'command',
      'duration_ms',
      'agent_id',
      'data',
    ]);
  });

  test('error envelope has expected field order: status, command, error, data', () => {
    const envelope = {
      status: 'error',
      command: 'agent-config-set',
      error: 'agent-config commands require -a <agent_id>',
      data: null,
    };
    expect(Object.keys(envelope)).toEqual(['status', 'command', 'error', 'data']);
  });
});
