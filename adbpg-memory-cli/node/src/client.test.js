'use strict';

/**
 * Unit tests for client.js — ADBPG Memory CLI Node.js client.
 */

const {
  textToMessages,
  parseJsonMessages,
  ADBPGMemoryCLIClient,
} = require('./client');

// ------------------------------------------------------------------
// textToMessages
// ------------------------------------------------------------------

describe('textToMessages', () => {
  test('basic text', () => {
    expect(textToMessages('hello world')).toEqual([
      { role: 'user', content: 'hello world' },
    ]);
  });

  test('empty string', () => {
    expect(textToMessages('')).toEqual([{ role: 'user', content: '' }]);
  });

  test('multiline text', () => {
    const text = 'line1\nline2\nline3';
    const result = textToMessages(text);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe(text);
  });

  test('unicode text', () => {
    const text = '你好世界 🌍';
    const result = textToMessages(text);
    expect(result[0].content).toBe(text);
  });
});

// ------------------------------------------------------------------
// parseJsonMessages
// ------------------------------------------------------------------

describe('parseJsonMessages', () => {
  test('valid array', () => {
    const data = [{ role: 'user', content: 'hi' }];
    expect(parseJsonMessages(JSON.stringify(data))).toEqual(data);
  });

  test('empty array', () => {
    expect(parseJsonMessages('[]')).toEqual([]);
  });

  test('not array throws', () => {
    expect(() => parseJsonMessages('{"role": "user"}')).toThrow(
      'must be an array'
    );
  });

  test('invalid JSON throws', () => {
    expect(() => parseJsonMessages('not json at all')).toThrow('Invalid JSON');
  });

  test('string value throws', () => {
    expect(() => parseJsonMessages('"just a string"')).toThrow(
      'must be an array'
    );
  });
});

// ------------------------------------------------------------------
// ADBPGMemoryCLIClient — constructor
// ------------------------------------------------------------------

describe('ADBPGMemoryCLIClient constructor', () => {
  test('default api mode is sql', () => {
    const client = new ADBPGMemoryCLIClient({});
    expect(client.apiMode).toBe('sql');
  });

  test('rest api mode', () => {
    const client = new ADBPGMemoryCLIClient({ api_mode: 'rest' });
    expect(client.apiMode).toBe('rest');
  });

  test('config stored', () => {
    const cfg = { api_mode: 'sql', host: 'localhost' };
    const client = new ADBPGMemoryCLIClient(cfg);
    expect(client._config).toBe(cfg);
  });
});

// ------------------------------------------------------------------
// ADBPGMemoryCLIClient — SQL mode (mocked pg)
// ------------------------------------------------------------------

describe('ADBPGMemoryCLIClient SQL mode', () => {
  function makeClient(overrides = {}) {
    const cfg = {
      api_mode: 'sql',
      host: 'localhost',
      port: 5432,
      user: 'test',
      password: 'pass',
      dbname: 'testdb',
      llm_model: 'qwen-plus',
      llm_api_key: 'sk-test',
      llm_base_url: 'https://llm.example.com',
      embedding_model: 'text-embedding-v3',
      embedding_api_key: 'sk-emb',
      embedding_base_url: 'https://emb.example.com',
      embedding_dims: 1024,
      search_timeout: 10.0,
      ...overrides,
    };
    return new ADBPGMemoryCLIClient(cfg);
  }

  function mockPgClient(queryResults) {
    let callIndex = 0;
    const mock = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockImplementation(() => {
        const result = queryResults[callIndex] || { rows: [] };
        callIndex++;
        return Promise.resolve(result);
      }),
      end: jest.fn().mockResolvedValue(undefined),
    };
    return mock;
  }

  test('add calls SQL', async () => {
    const client = makeClient();
    const pgMock = mockPgClient([
      { rows: [{ port: 5432 }] },           // internal port
      { rows: [{ config: 'ok' }] },          // config
      { rows: [{ add: '{"result":"ok"}' }] }, // add
    ]);
    client._sqlCreateClient = () => pgMock;

    const result = await client.add(
      [{ role: 'user', content: 'test' }],
      { userId: 'alice' }
    );
    expect(result).toEqual({ result: 'ok' });
    expect(pgMock.end).toHaveBeenCalled();
  });

  test('search calls SQL', async () => {
    const client = makeClient();
    const searchResult = JSON.stringify({
      results: [{ id: '1', memory: 'test' }],
    });
    const pgMock = mockPgClient([
      { rows: [{ port: 5432 }] },
      { rows: [{ config: 'ok' }] },
      { rows: [] },                          // SET statement_timeout
      { rows: [{ search: searchResult }] },  // search
      { rows: [] },                          // RESET statement_timeout
    ]);
    client._sqlCreateClient = () => pgMock;

    const results = await client.search('test query', { userId: 'alice' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
    expect(pgMock.end).toHaveBeenCalled();
  });

  test('search empty result', async () => {
    const client = makeClient();
    const pgMock = mockPgClient([
      { rows: [{ port: 5432 }] },
      { rows: [{ config: 'ok' }] },
      { rows: [] },                          // SET statement_timeout
      { rows: [{ search: null }] },          // empty search
      { rows: [] },                          // RESET statement_timeout
    ]);
    client._sqlCreateClient = () => pgMock;

    const results = await client.search('nothing', { userId: 'alice' });
    expect(results).toEqual([]);
  });

  test('listAll calls SQL', async () => {
    const client = makeClient();
    const listResult = JSON.stringify([{ id: '1', memory: 'mem1' }]);
    const pgMock = mockPgClient([
      { rows: [{ port: 5432 }] },
      { rows: [{ config: 'ok' }] },
      { rows: [{ get_all: listResult }] },
    ]);
    client._sqlCreateClient = () => pgMock;

    const results = await client.listAll({ userId: 'alice' });
    expect(results).toHaveLength(1);
  });

  test('deleteAll calls SQL', async () => {
    const client = makeClient();
    const pgMock = mockPgClient([
      { rows: [{ port: 5432 }] },
      { rows: [{ config: 'ok' }] },
      { rows: [{ delete_all: '{"deleted":3}' }] },
    ]);
    client._sqlCreateClient = () => pgMock;

    const result = await client.deleteAll({ userId: 'alice' });
    expect(result).toEqual({ deleted: 3 });
  });

  test('testConnection success', async () => {
    const client = makeClient();
    const pgMock = mockPgClient([
      { rows: [{ port: 5432 }] },
    ]);
    client._sqlCreateClient = () => pgMock;

    const { success, message } = await client.testConnection();
    expect(success).toBe(true);
    expect(message).toContain('5432');
  });

  test('testConnection failure', async () => {
    const client = makeClient();
    client._sqlCreateClient = () => ({
      connect: jest.fn().mockRejectedValue(new Error('Connection refused')),
      end: jest.fn().mockResolvedValue(undefined),
    });

    const { success, message } = await client.testConnection();
    expect(success).toBe(false);
    expect(message).toContain('Connection refused');
  });
});

// ------------------------------------------------------------------
// ADBPGMemoryCLIClient — REST mode (mocked fetch)
// ------------------------------------------------------------------

describe('ADBPGMemoryCLIClient REST mode', () => {
  function makeClient(overrides = {}) {
    const cfg = {
      api_mode: 'rest',
      rest_base_url: 'https://api.example.com',
      rest_api_key: 'sk-rest-key',
      search_timeout: 10.0,
      ...overrides,
    };
    return new ADBPGMemoryCLIClient(cfg);
  }

  function mockFetch(jsonResponse, ok = true) {
    return jest.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? 'OK' : 'Internal Server Error',
      json: () => Promise.resolve(jsonResponse),
      text: () => Promise.resolve(JSON.stringify(jsonResponse)),
    });
  }

  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('add posts to /memories', async () => {
    const client = makeClient();
    global.fetch = mockFetch({ result: 'ok' });

    const result = await client.add(
      [{ role: 'user', content: 'test' }],
      { userId: 'alice' }
    );
    expect(result).toEqual({ result: 'ok' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const callUrl = global.fetch.mock.calls[0][0];
    expect(callUrl).toContain('/memories');
  });

  test('search posts to /search', async () => {
    const client = makeClient();
    global.fetch = mockFetch({
      results: [{ id: '1', memory: 'test' }],
    });

    const results = await client.search('query', { userId: 'alice' });
    expect(results).toHaveLength(1);
    const callUrl = global.fetch.mock.calls[0][0];
    expect(callUrl).toContain('/search');
  });

  test('search respects limit', async () => {
    const client = makeClient();
    global.fetch = mockFetch({
      results: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });

    const results = await client.search('query', {
      userId: 'alice',
      limit: 2,
    });
    expect(results).toHaveLength(2);
  });

  test('listAll gets /memories', async () => {
    const client = makeClient();
    global.fetch = mockFetch({
      results: [{ id: '1' }, { id: '2' }],
    });

    const results = await client.listAll({ userId: 'alice' });
    expect(results).toHaveLength(2);
    const callUrl = global.fetch.mock.calls[0][0];
    expect(callUrl).toContain('/memories');
    const callOpts = global.fetch.mock.calls[0][1];
    expect(callOpts.method).toBe('GET');
  });

  test('deleteAll deletes /memories', async () => {
    const client = makeClient();
    global.fetch = mockFetch({ deleted: 5 });

    const result = await client.deleteAll({ userId: 'alice' });
    expect(result).toEqual({ deleted: 5 });
    const callOpts = global.fetch.mock.calls[0][1];
    expect(callOpts.method).toBe('DELETE');
  });

  test('testConnection success', async () => {
    const client = makeClient();
    global.fetch = mockFetch({ status: 'ok' });

    const { success, message } = await client.testConnection();
    expect(success).toBe(true);
    expect(message).toContain('api.example.com');
  });

  test('testConnection failure', async () => {
    const client = makeClient();
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { success, message } = await client.testConnection();
    expect(success).toBe(false);
    expect(message).toContain('Network error');
  });

  test('REST URL construction with trailing slash', () => {
    const client = makeClient({ rest_base_url: 'https://api.example.com/' });
    expect(client._restUrl('/memories')).toBe(
      'https://api.example.com/memories'
    );
  });

  test('REST URL construction without trailing slash', () => {
    const client = makeClient({ rest_base_url: 'https://api.example.com' });
    expect(client._restUrl('/memories')).toBe(
      'https://api.example.com/memories'
    );
  });

  test('REST headers include auth', () => {
    const client = makeClient({ rest_api_key: 'mykey' });
    const headers = client._restHeaders();
    expect(headers['Authorization']).toBe('Bearer mykey');
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ------------------------------------------------------------------
// Result parsing helpers
// ------------------------------------------------------------------

describe('_parseSearchResult', () => {
  test('JSON string with results key', () => {
    const raw = JSON.stringify({ results: [{ id: '1' }] });
    expect(ADBPGMemoryCLIClient._parseSearchResult(raw)).toEqual([
      { id: '1' },
    ]);
  });

  test('JSON string list', () => {
    const raw = JSON.stringify([{ id: '1' }]);
    expect(ADBPGMemoryCLIClient._parseSearchResult(raw)).toEqual([
      { id: '1' },
    ]);
  });

  test('dict with results key', () => {
    const raw = { results: [{ id: '1' }] };
    expect(ADBPGMemoryCLIClient._parseSearchResult(raw)).toEqual([
      { id: '1' },
    ]);
  });

  test('list passthrough', () => {
    const raw = [{ id: '1' }];
    expect(ADBPGMemoryCLIClient._parseSearchResult(raw)).toEqual([
      { id: '1' },
    ]);
  });

  test('null returns empty', () => {
    expect(ADBPGMemoryCLIClient._parseSearchResult(null)).toEqual([]);
  });

  test('undefined returns empty', () => {
    expect(ADBPGMemoryCLIClient._parseSearchResult(undefined)).toEqual([]);
  });
});

describe('_parseListResult', () => {
  test('JSON string with results key', () => {
    const raw = JSON.stringify({ results: [{ id: '1' }] });
    expect(ADBPGMemoryCLIClient._parseListResult(raw)).toEqual([{ id: '1' }]);
  });

  test('JSON string with memories key', () => {
    const raw = JSON.stringify({ memories: [{ id: '1' }] });
    expect(ADBPGMemoryCLIClient._parseListResult(raw)).toEqual([{ id: '1' }]);
  });

  test('dict with memories key', () => {
    const raw = { memories: [{ id: '1' }] };
    expect(ADBPGMemoryCLIClient._parseListResult(raw)).toEqual([{ id: '1' }]);
  });

  test('list passthrough', () => {
    const raw = [{ id: '1' }];
    expect(ADBPGMemoryCLIClient._parseListResult(raw)).toEqual([{ id: '1' }]);
  });

  test('null returns empty', () => {
    expect(ADBPGMemoryCLIClient._parseListResult(null)).toEqual([]);
  });
});
