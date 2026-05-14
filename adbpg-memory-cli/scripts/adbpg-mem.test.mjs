/**
 * node:test suite for adbpg-mem.mjs.
 *
 * Run with:
 *   node --test scripts/adbpg-mem.test.mjs
 *
 * Zero npm dependencies — uses only Node built-ins.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { run, __test as T } from './adbpg-mem.mjs';

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

function mkTmpDir(label) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `adbpg-mem-${label}-`));
  return base;
}

function rmTmp(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {
    // ignore
  }
}

function makeIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    },
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

function makeFetchMock(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

function jsonResp(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function textResp(body, { status = 200, statusText = 'OK' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => body,
  };
}

function errResp(status, statusText, body = '') {
  return {
    ok: false,
    status,
    statusText,
    json: async () => {
      throw new Error('not json');
    },
    text: async () => body,
  };
}

function writeWorkspaceConfig(cwd, cfg) {
  const dir = path.join(cwd, '.adbpg-mem');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

const SAMPLE_CONFIG = {
  api_mode: 'rest',
  rest_base_url: 'https://example.test/api',
  rest_api_key: 'sekret-key-1234567890',
  user_id: 'alice',
  search_timeout: 10,
};

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

describe('parseArgv', () => {
  test('positionals + flags after subcommand', () => {
    const r = T.parseArgv(['add', 'hello world', '-u', 'bob', '-a', 'agentX', '--agent']);
    assert.equal(r.command, 'add');
    assert.equal(r.flags.user_id, 'bob');
    assert.equal(r.flags.agent_id, 'agentX');
    assert.equal(r.flags.agent_output, true);
    assert.deepEqual(r.positional, ['add', 'hello world']);
  });

  test('-a before the command is also recognised (flags scanned globally)', () => {
    const r = T.parseArgv(['-a', 'agentZ', 'list', '--agent']);
    assert.equal(r.command, 'list');
    assert.equal(r.flags.agent_id, 'agentZ');
    assert.equal(r.flags.agent_output, true);
  });

  test('--agent (output) is distinct from -a (agent_id)', () => {
    const r = T.parseArgv(['--agent', '-a', 'foo']);
    assert.equal(r.flags.agent_output, true);
    assert.equal(r.flags.agent_id, 'foo');
  });

  test('--user-id is treated as init-only flag, not user_id', () => {
    const r = T.parseArgv(['config', 'init', 'http://x', 'k', '--user-id', 'me']);
    assert.equal(r.flags.user_id_init, 'me');
    assert.equal(r.flags.user_id, undefined);
  });

  test('--limit captured as string', () => {
    const r = T.parseArgv(['search', 'q', '--limit', '7']);
    assert.equal(r.flags.limit, '7');
  });

  test('agent-config set with key + value positional', () => {
    const r = T.parseArgv(['agent-config', 'set', 'isolation_agent', 'true', '-a', 'x']);
    assert.equal(r.command, 'agent-config');
    assert.equal(r.sub, 'set');
    assert.deepEqual(r.positional.slice(2), ['isolation_agent', 'true']);
  });

  test('missing value for value-bearing flag returns error', () => {
    const r = T.parseArgv(['add', 'hi', '-u']);
    assert.match(r.error, /missing value for -u/);
  });
});

// ---------------------------------------------------------------------------
// config loading priority
// ---------------------------------------------------------------------------

describe('loadConfig priority', () => {
  let tmp;
  let home;

  beforeEach(() => {
    tmp = mkTmpDir('cfg');
    home = mkTmpDir('home');
  });
  afterEach(() => {
    rmTmp(tmp);
    rmTmp(home);
  });

  test('env vars win over both files', () => {
    writeWorkspaceConfig(tmp, SAMPLE_CONFIG);
    writeWorkspaceConfig(home, SAMPLE_CONFIG);
    const { config, source } = T.loadConfig({
      env: {
        ADBPG_REST_BASE_URL: 'https://env.test',
        ADBPG_REST_API_KEY: 'env-key',
        ADBPG_USER_ID: 'envuser',
      },
      cwd: tmp,
      homedir: home,
    });
    assert.equal(source, 'env');
    assert.equal(config.rest_base_url, 'https://env.test');
    assert.equal(config.rest_api_key, 'env-key');
    assert.equal(config.user_id, 'envuser');
  });

  test('cwd workspace wins over home', () => {
    writeWorkspaceConfig(tmp, { ...SAMPLE_CONFIG, rest_base_url: 'https://cwd.test' });
    writeWorkspaceConfig(home, { ...SAMPLE_CONFIG, rest_base_url: 'https://home.test' });
    const { config, source } = T.loadConfig({ env: {}, cwd: tmp, homedir: home });
    assert.equal(config.rest_base_url, 'https://cwd.test');
    assert.equal(source, path.join(tmp, '.adbpg-mem', 'config.json'));
  });

  test('falls back to home when cwd missing', () => {
    writeWorkspaceConfig(home, { ...SAMPLE_CONFIG, rest_base_url: 'https://home.test' });
    const { config, source } = T.loadConfig({ env: {}, cwd: tmp, homedir: home });
    assert.equal(config.rest_base_url, 'https://home.test');
    assert.equal(source, path.join(home, '.adbpg-mem', 'config.json'));
  });

  test('returns null when nothing configured', () => {
    const { config, source } = T.loadConfig({ env: {}, cwd: tmp, homedir: home });
    assert.equal(config, null);
    assert.equal(source, null);
  });

  test('partial env (only base_url, no api_key) does NOT activate env tier', () => {
    writeWorkspaceConfig(home, SAMPLE_CONFIG);
    const { config, source } = T.loadConfig({
      env: { ADBPG_REST_BASE_URL: 'https://env.test' },
      cwd: tmp,
      homedir: home,
    });
    // home wins because env tier is incomplete
    assert.equal(source, path.join(home, '.adbpg-mem', 'config.json'));
    assert.notEqual(config.rest_base_url, 'https://env.test');
  });
});

// ---------------------------------------------------------------------------
// config init
// ---------------------------------------------------------------------------

describe('config init', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmpDir('init');
  });
  afterEach(() => rmTmp(tmp));

  test('writes <cwd>/.adbpg-mem/config.json with mode 0600', async () => {
    const cap = makeIo();
    const code = await run(
      ['config', 'init', 'https://example.test/api', 'topsecret', '--user-id', 'alice'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const filePath = path.join(tmp, '.adbpg-mem', 'config.json');
    assert.ok(fs.existsSync(filePath));
    const stat = fs.statSync(filePath);
    assert.equal(stat.mode & 0o777, 0o600);
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.equal(written.api_mode, 'rest');
    assert.equal(written.rest_base_url, 'https://example.test/api');
    assert.equal(written.rest_api_key, 'topsecret');
    assert.equal(written.user_id, 'alice');
  });

  test('agent envelope mode produces JSON', async () => {
    const cap = makeIo();
    const code = await run(
      ['config', 'init', 'https://example.test/api', 'topsecret', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.command, 'config-init');
    assert.match(env.data.path, /\.adbpg-mem\/config\.json$/);
  });
});

// ---------------------------------------------------------------------------
// config show
// ---------------------------------------------------------------------------

describe('config show', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmpDir('show');
  });
  afterEach(() => rmTmp(tmp));

  test('masks api_key and reports source', async () => {
    writeWorkspaceConfig(tmp, SAMPLE_CONFIG);
    const cap = makeIo();
    const code = await run(['config', 'show', '--agent'], {
      io: cap.io,
      cwd: tmp,
      env: {},
      homedir: mkTmpDir('home-empty'),
    });
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.command, 'config-show');
    assert.equal(env.data.rest_base_url, SAMPLE_CONFIG.rest_base_url);
    assert.match(env.data.rest_api_key, /\*\*\*\*/);
    assert.match(env.data.source, /\.adbpg-mem\/config\.json$/);
  });

  test('missing config emits error envelope', async () => {
    const cap = makeIo();
    const homeEmpty = mkTmpDir('home-empty2');
    const code = await run(['config', 'show', '--agent'], {
      io: cap.io,
      cwd: tmp,
      env: {},
      homedir: homeEmpty,
    });
    rmTmp(homeEmpty);
    assert.equal(code, 1);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.status, 'error');
    assert.match(env.error, /missing REST configuration/);
  });
});

// ---------------------------------------------------------------------------
// add / search / list / delete REST contracts
// ---------------------------------------------------------------------------

describe('REST commands (mocked fetch)', () => {
  let tmp;
  let homeEmpty;
  beforeEach(() => {
    tmp = mkTmpDir('rest');
    homeEmpty = mkTmpDir('home-empty3');
    writeWorkspaceConfig(tmp, SAMPLE_CONFIG);
  });
  afterEach(() => {
    rmTmp(tmp);
    rmTmp(homeEmpty);
  });

  test('add posts to /memories with correct headers and body', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => jsonResp({ id: 'm-1', status: 'ok' }));
    const code = await run(
      ['add', 'hello world', '-u', 'alice', '-a', 'agentA', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    assert.equal(fetchMock.calls.length, 1);
    const call = fetchMock.calls[0];
    assert.equal(call.url, 'https://example.test/api/memories');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, `Bearer ${SAMPLE_CONFIG.rest_api_key}`);
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(call.init.body);
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hello world' }]);
    assert.equal(body.user_id, 'alice');
    assert.equal(body.agent_id, 'agentA');
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.command, 'add');
    assert.deepEqual(env.scope, { user_id: 'alice', agent_id: 'agentA', run_id: '' });
  });

  test('add --json-messages overrides plain text', async () => {
    const cap = makeIo();
    const messages = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ];
    const fetchMock = makeFetchMock(() => jsonResp({}));
    const code = await run(
      ['add', '--json-messages', JSON.stringify(messages), '-u', 'alice', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.deepEqual(body.messages, messages);
  });

  test('add PENDING is propagated as envelope status=pending', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() =>
      jsonResp({ status: 'PENDING', task_id: 't-99' })
    );
    const code = await run(
      ['add', 'memo', '-u', 'alice', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'pending');
    assert.equal(env.command, 'add');
    assert.equal(env.data.task_id, 't-99');
  });

  test('search posts to /search and respects --limit', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() =>
      jsonResp({
        results: [
          { id: 'r1', content: 'a' },
          { id: 'r2', content: 'b' },
          { id: 'r3', content: 'c' },
        ],
      })
    );
    const code = await run(
      ['search', 'pizza', '-u', 'alice', '--limit', '2', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    assert.equal(fetchMock.calls[0].url, 'https://example.test/api/search');
    const body = JSON.parse(fetchMock.calls[0].init.body);
    assert.equal(body.query, 'pizza');
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.count, 2);
    assert.equal(env.data.length, 2);
  });

  test('list issues GET with query string', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() =>
      jsonResp({ results: [{ id: 'm1' }, { id: 'm2' }] })
    );
    const code = await run(
      ['list', '-u', 'alice', '-a', 'agentB', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    assert.equal(fetchMock.calls[0].init.method, 'GET');
    assert.match(fetchMock.calls[0].url, /\/memories\?/);
    assert.match(fetchMock.calls[0].url, /user_id=alice/);
    assert.match(fetchMock.calls[0].url, /agent_id=agentB/);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.count, 2);
  });

  test('delete --all requires --force', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => jsonResp({}));
    const code = await run(
      ['delete', '--all', '-u', 'alice', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 1);
    assert.equal(fetchMock.calls.length, 0);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.status, 'error');
  });

  test('delete --all --force issues DELETE', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => jsonResp({ deleted: 5 }));
    const code = await run(
      ['delete', '--all', '-u', 'alice', '--force', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    assert.equal(fetchMock.calls[0].init.method, 'DELETE');
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.data.deleted, 5);
  });

  test('HTTP 500 produces error envelope', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => errResp(500, 'Server Error'));
    const code = await run(
      ['add', 'x', '-u', 'alice', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 1);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.status, 'error');
    assert.match(env.error, /HTTP 500/);
  });

  test('non-JSON body falls back to {result: <text>}', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => textResp('plain text response'));
    const code = await run(
      ['add', 'hi', '-u', 'alice', '--agent'],
      { io: cap.io, cwd: tmp, env: {}, homedir: homeEmpty, fetch: fetchMock }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.data.result, 'plain text response');
  });

  test('status with /health 404 returns ok with note', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => errResp(404, 'Not Found'));
    const code = await run(['status', '--agent'], {
      io: cap.io,
      cwd: tmp,
      env: {},
      homedir: homeEmpty,
      fetch: fetchMock,
    });
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.match(env.data.message, /no \/health endpoint/);
  });

  test('status with /health 200 returns ok', async () => {
    const cap = makeIo();
    const fetchMock = makeFetchMock(() => jsonResp({ status: 'healthy' }));
    const code = await run(['status', '--agent'], {
      io: cap.io,
      cwd: tmp,
      env: {},
      homedir: homeEmpty,
      fetch: fetchMock,
    });
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.data.connected, true);
  });
});

// ---------------------------------------------------------------------------
// agent-config CRUD
// ---------------------------------------------------------------------------

describe('agent-config', () => {
  let tmp;
  beforeEach(() => {
    tmp = mkTmpDir('ac');
  });
  afterEach(() => rmTmp(tmp));

  test('show on missing agent returns defaults', async () => {
    const cap = makeIo();
    const code = await run(['agent-config', 'show', '-a', 'newAgent', '--agent'], {
      io: cap.io,
      cwd: tmp,
    });
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.command, 'agent-config-show');
    assert.equal(env.agent_id, 'newAgent');
    assert.deepEqual(env.data, {
      isolation_agent: false,
      isolation_run_mode: 'off',
    });
  });

  test('set + show round-trip persists 0600', async () => {
    const cap = makeIo();
    let code = await run(
      ['agent-config', 'set', 'isolation_agent', 'true', '-a', 'a1', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const filePath = path.join(tmp, '.adbpg-mem', 'agents', 'a1.json');
    assert.ok(fs.existsSync(filePath));
    const stat = fs.statSync(filePath);
    assert.equal(stat.mode & 0o777, 0o600);

    const cap2 = makeIo();
    code = await run(['agent-config', 'show', '-a', 'a1', '--agent'], { io: cap2.io, cwd: tmp });
    assert.equal(code, 0);
    const env = JSON.parse(cap2.stdout.trim());
    assert.equal(env.data.isolation_agent, true);
  });

  test('boolean is case-insensitive', async () => {
    const cap = makeIo();
    const code = await run(
      ['agent-config', 'set', 'isolation_agent', 'TRUE', '-a', 'a2', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.data.value, true);
  });

  test('boolean refuses trimmed input ("true " with space)', async () => {
    const cap = makeIo();
    const code = await run(
      ['agent-config', 'set', 'isolation_agent', 'true ', '-a', 'a3', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 2);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.status, 'error');
    assert.equal(env.error, "invalid value for isolation_agent: expected 'true' or 'false', got 'true '");
  });

  test('enum invalid value error matches Node CLI text', async () => {
    const cap = makeIo();
    const code = await run(
      ['agent-config', 'set', 'isolation_run_mode', 'bogus', '-a', 'a4', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 2);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.error, "invalid value for isolation_run_mode: must be one of off, manual, auto, tag, got 'bogus'");
  });

  test('unknown key error matches Node CLI text', async () => {
    const cap = makeIo();
    const code = await run(
      ['agent-config', 'set', 'banana', 'x', '-a', 'a5', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 2);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.error, "unknown key 'banana'. Known keys: isolation_agent, isolation_run_mode, current_run_id");
  });

  test('missing -a yields the canonical error text', async () => {
    const cap = makeIo();
    const code = await run(['agent-config', 'show', '--agent'], { io: cap.io, cwd: tmp });
    assert.equal(code, 2);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.error, 'agent-config commands require -a <agent_id>');
  });

  test('invalid agent_id format error', async () => {
    const cap = makeIo();
    const code = await run(['agent-config', 'show', '-a', 'bad/id!', '--agent'], {
      io: cap.io,
      cwd: tmp,
    });
    assert.equal(code, 2);
    const env = JSON.parse(cap.stderr.trim());
    assert.match(env.error, /^invalid agent_id format: /);
  });

  test('unset on missing key is idempotent (status=ok, removed=false)', async () => {
    const cap = makeIo();
    // create file with just one key
    await run(
      ['agent-config', 'set', 'isolation_agent', 'true', '-a', 'a6', '--agent'],
      { io: makeIo().io, cwd: tmp }
    );
    const code = await run(
      ['agent-config', 'unset', 'current_run_id', '-a', 'a6', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
    assert.equal(env.data.removed, false);
  });

  test('unset on file-less agent is idempotent', async () => {
    const cap = makeIo();
    const code = await run(
      ['agent-config', 'unset', 'isolation_agent', '-a', 'noFile', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.status, 'ok');
  });

  test('get returns null for unset current_run_id', async () => {
    const cap = makeIo();
    const code = await run(
      ['agent-config', 'get', 'current_run_id', '-a', 'a7', '--agent'],
      { io: cap.io, cwd: tmp }
    );
    assert.equal(code, 0);
    const env = JSON.parse(cap.stdout.trim());
    assert.equal(env.data.value, null);
  });
});

// ---------------------------------------------------------------------------
// envelope shape tests
// ---------------------------------------------------------------------------

describe('envelope shapes', () => {
  test('envelopeOk includes count when provided', () => {
    const env = T.envelopeOk('search', [], { user_id: 'a' }, 10, 0);
    assert.equal(env.status, 'ok');
    assert.equal(env.count, 0);
  });

  test('envelopeOk omits count when undefined', () => {
    const env = T.envelopeOk('add', {}, { user_id: 'a' }, 10);
    assert.equal('count' in env, false);
  });

  test('envelopePending shape', () => {
    const env = T.envelopePending('add', { status: 'PENDING' }, { user_id: 'a' }, 50);
    assert.equal(env.status, 'pending');
    assert.equal(env.data.status, 'PENDING');
  });

  test('envelopeError shape', () => {
    const env = T.envelopeError('add', 'oops');
    assert.equal(env.status, 'error');
    assert.equal(env.error, 'oops');
    assert.equal(env.data, null);
  });
});

// ---------------------------------------------------------------------------
// missing-config error path
// ---------------------------------------------------------------------------

describe('missing config produces actionable error', () => {
  let tmp;
  let homeEmpty;
  beforeEach(() => {
    tmp = mkTmpDir('miss');
    homeEmpty = mkTmpDir('home-miss');
  });
  afterEach(() => {
    rmTmp(tmp);
    rmTmp(homeEmpty);
  });

  test('list with no config => error envelope mentioning all 3 fallbacks', async () => {
    const cap = makeIo();
    const code = await run(['list', '-u', 'alice', '--agent'], {
      io: cap.io,
      cwd: tmp,
      env: {},
      homedir: homeEmpty,
    });
    assert.equal(code, 1);
    const env = JSON.parse(cap.stderr.trim());
    assert.equal(env.status, 'error');
    assert.match(env.error, /ADBPG_REST_BASE_URL/);
    assert.match(env.error, /config init/);
    assert.match(env.error, /\.adbpg-mem\/config\.json/);
  });
});
