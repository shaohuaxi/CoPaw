'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  ENV_MAP,
  loadConfig,
  saveConfig,
  mergeConfig,
  maskSensitive,
  validateConfig,
  _loadEnvConfig,
} = require('./config');

// Helper: create a temp dir for each test
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
}

describe('loadConfig', () => {
  test('returns empty object when file does not exist', () => {
    const tmp = makeTmpDir();
    const missing = path.join(tmp, 'nonexistent', 'config.json');
    expect(loadConfig(missing)).toEqual({});
  });

  test('loads valid JSON', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    const cfg = { api_mode: 'sql', host: 'localhost' };
    fs.writeFileSync(filePath, JSON.stringify(cfg), 'utf-8');
    expect(loadConfig(filePath)).toEqual(cfg);
  });
});

describe('saveConfig', () => {
  test('creates directory and file', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'sub', 'dir', 'config.json');
    const cfg = { api_mode: 'rest', rest_base_url: 'https://example.com' };
    saveConfig(cfg, filePath);
    expect(fs.existsSync(filePath)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(loaded).toEqual(cfg);
  });

  test('overwrites existing file', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({ a: 1 }, filePath);
    saveConfig({ b: 2 }, filePath);
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({ b: 2 });
  });
});

describe('mergeConfig', () => {
  test('file only', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({ api_mode: 'sql', host: 'filehost' }, filePath);
    const result = mergeConfig(null, filePath);
    expect(result.host).toBe('filehost');
  });

  test('env overrides file', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({ api_mode: 'sql', host: 'filehost' }, filePath);
    const origEnv = process.env.ADBPG_MEM_HOST;
    process.env.ADBPG_MEM_HOST = 'envhost';
    try {
      const result = mergeConfig(null, filePath);
      expect(result.host).toBe('envhost');
    } finally {
      if (origEnv === undefined) delete process.env.ADBPG_MEM_HOST;
      else process.env.ADBPG_MEM_HOST = origEnv;
    }
  });

  test('cli overrides env', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({ api_mode: 'sql', host: 'filehost' }, filePath);
    const origEnv = process.env.ADBPG_MEM_HOST;
    process.env.ADBPG_MEM_HOST = 'envhost';
    try {
      const result = mergeConfig({ host: 'clihost' }, filePath);
      expect(result.host).toBe('clihost');
    } finally {
      if (origEnv === undefined) delete process.env.ADBPG_MEM_HOST;
      else process.env.ADBPG_MEM_HOST = origEnv;
    }
  });

  test('null/undefined cli flags are ignored', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({ host: 'filehost' }, filePath);
    const result = mergeConfig({ host: null }, filePath);
    expect(result.host).toBe('filehost');
  });

  test('port env converted to int', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({}, filePath);
    const origEnv = process.env.ADBPG_MEM_PORT;
    process.env.ADBPG_MEM_PORT = '5433';
    try {
      const result = mergeConfig(null, filePath);
      expect(result.port).toBe(5433);
      expect(typeof result.port).toBe('number');
    } finally {
      if (origEnv === undefined) delete process.env.ADBPG_MEM_PORT;
      else process.env.ADBPG_MEM_PORT = origEnv;
    }
  });

  test('all env vars mapped', () => {
    const tmp = makeTmpDir();
    const filePath = path.join(tmp, 'config.json');
    saveConfig({}, filePath);
    const saved = {};
    for (const [envVar, configKey] of Object.entries(ENV_MAP)) {
      saved[envVar] = process.env[envVar];
      process.env[envVar] = configKey !== 'port' ? 'testval' : '9999';
    }
    try {
      const result = mergeConfig(null, filePath);
      for (const configKey of Object.values(ENV_MAP)) {
        expect(result).toHaveProperty(configKey);
      }
    } finally {
      for (const [envVar] of Object.entries(ENV_MAP)) {
        if (saved[envVar] === undefined) delete process.env[envVar];
        else process.env[envVar] = saved[envVar];
      }
    }
  });
});

describe('maskSensitive', () => {
  test('masks password', () => {
    expect(maskSensitive({ password: 'supersecret' })).toEqual({ password: 'supe***' });
  });

  test('masks api_key', () => {
    expect(maskSensitive({ rest_api_key: 'sk-abcdef123' })).toEqual({ rest_api_key: 'sk-a***' });
  });

  test('short value masked as stars', () => {
    expect(maskSensitive({ password: 'abc' })).toEqual({ password: '***' });
  });

  test('exactly four chars masked as stars', () => {
    expect(maskSensitive({ password: 'abcd' })).toEqual({ password: '***' });
  });

  test('five chars shows prefix', () => {
    expect(maskSensitive({ password: 'abcde' })).toEqual({ password: 'abcd***' });
  });

  test('non-sensitive fields unchanged', () => {
    const cfg = { host: 'localhost', port: 5432 };
    expect(maskSensitive(cfg)).toEqual(cfg);
  });

  test('empty password unchanged', () => {
    expect(maskSensitive({ password: '' })).toEqual({ password: '' });
  });

  test('returns a copy', () => {
    const cfg = { password: 'secret123' };
    const masked = maskSensitive(cfg);
    expect(masked).not.toBe(cfg);
    expect(cfg.password).toBe('secret123');
  });
});

describe('validateConfig', () => {
  test('valid sql config', () => {
    const cfg = {
      api_mode: 'sql',
      host: 'localhost',
      port: 5432,
      user: 'admin',
      password: 'pass',
      dbname: 'mydb',
    };
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  test('valid rest config', () => {
    const cfg = {
      api_mode: 'rest',
      rest_base_url: 'https://example.com',
      rest_api_key: 'sk-123',
    };
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(true);
    expect(errors).toEqual([]);
  });

  test('missing api_mode', () => {
    const { valid, errors } = validateConfig({});
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('api_mode'))).toBe(true);
  });

  test('invalid api_mode', () => {
    const { valid, errors } = validateConfig({ api_mode: 'grpc' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('sql') && e.includes('rest'))).toBe(true);
  });

  test('sql missing host', () => {
    const cfg = {
      api_mode: 'sql',
      port: 5432,
      user: 'admin',
      password: 'pass',
      dbname: 'mydb',
    };
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('host'))).toBe(true);
  });

  test('sql empty string field', () => {
    const cfg = {
      api_mode: 'sql',
      host: '',
      port: 5432,
      user: 'admin',
      password: 'pass',
      dbname: 'mydb',
    };
    const { valid, errors } = validateConfig(cfg);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('host'))).toBe(true);
  });

  test('rest missing base_url', () => {
    const { valid, errors } = validateConfig({ api_mode: 'rest', rest_api_key: 'sk-123' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('rest_base_url'))).toBe(true);
  });

  test('rest missing api_key', () => {
    const { valid, errors } = validateConfig({ api_mode: 'rest', rest_base_url: 'https://example.com' });
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('rest_api_key'))).toBe(true);
  });

  test('multiple missing fields', () => {
    const { valid, errors } = validateConfig({ api_mode: 'sql' });
    expect(valid).toBe(false);
    expect(errors.length).toBe(5); // host, port, user, password, dbname
  });
});
