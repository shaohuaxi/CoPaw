'use strict';

const { OutputFormatter, truncateContent, VALID_MODES } = require('./output');

describe('truncateContent', () => {
  test('short text unchanged', () => {
    expect(truncateContent('hello')).toBe('hello');
  });

  test('exact max length unchanged', () => {
    const text = 'a'.repeat(80);
    expect(truncateContent(text)).toBe(text);
  });

  test('over max length truncated', () => {
    const text = 'a'.repeat(100);
    expect(truncateContent(text)).toBe('a'.repeat(80) + '...');
  });

  test('custom max length', () => {
    expect(truncateContent('abcdefgh', 5)).toBe('abcde...');
  });

  test('empty string', () => {
    expect(truncateContent('')).toBe('');
  });
});

describe('OutputFormatter constructor', () => {
  test('valid modes', () => {
    for (const mode of VALID_MODES) {
      const fmt = new OutputFormatter(mode);
      expect(fmt.mode).toBe(mode);
    }
  });

  test('invalid mode throws', () => {
    expect(() => new OutputFormatter('xml')).toThrow('Invalid output mode');
  });

  test('default mode is text', () => {
    const fmt = new OutputFormatter();
    expect(fmt.mode).toBe('text');
  });
});

describe('isMachine', () => {
  test.each([
    ['text', false],
    ['table', false],
    ['json', true],
    ['agent', true],
    ['quiet', true],
  ])('mode %s => isMachine=%s', (mode, expected) => {
    const fmt = new OutputFormatter(mode);
    expect(fmt.isMachine).toBe(expected);
  });
});

describe('formatResult - agent mode', () => {
  const fmt = new OutputFormatter('agent');
  const scope = { user_id: 'alice', agent_id: '', run_id: '' };

  test('agent envelope structure', () => {
    const result = fmt.formatResult('search', [{ id: '1' }], scope, 42, 1);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('ok');
    expect(parsed.command).toBe('search');
    expect(parsed.duration_ms).toBe(42);
    expect(parsed.scope).toEqual(scope);
    expect(parsed.count).toBe(1);
    expect(parsed.data).toEqual([{ id: '1' }]);
  });

  test('agent envelope null count', () => {
    const result = fmt.formatResult('add', { id: 'x' }, scope, 10);
    const parsed = JSON.parse(result);
    expect(parsed.count).toBeNull();
  });
});

describe('formatResult - json mode', () => {
  const fmt = new OutputFormatter('json');

  test('json mode raw data', () => {
    const result = fmt.formatResult('list', [1, 2, 3], {}, 0);
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  test('json mode unicode', () => {
    const result = fmt.formatResult('search', { memory: '你好' }, {}, 0);
    expect(result).toContain('你好');
  });
});

describe('formatResult - quiet mode', () => {
  const fmt = new OutputFormatter('quiet');

  test('quiet with count', () => {
    const result = fmt.formatResult('delete', null, {}, 0, 5);
    expect(result).toBe('5');
  });

  test('quiet list ids', () => {
    const data = [{ id: 'a1' }, { id: 'b2' }];
    const result = fmt.formatResult('list', data, {}, 0);
    expect(result).toBe('a1\nb2');
  });

  test('quiet scalar', () => {
    const result = fmt.formatResult('add', 'done', {}, 0);
    expect(result).toBe('done');
  });
});

describe('formatResult - table mode', () => {
  const fmt = new OutputFormatter('table');

  test('table with dict list', () => {
    const data = [
      { id: '1', memory: 'hello' },
      { id: '2', memory: 'world' },
    ];
    const result = fmt.formatResult('list', data, {}, 0);
    const lines = result.split('\n');
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('memory');
    expect(lines.length).toBe(4); // header + separator + 2 rows
  });

  test('table empty list', () => {
    const result = fmt.formatResult('list', [], {}, 0);
    expect(result).toBe('[]');
  });
});

describe('formatResult - text mode', () => {
  const fmt = new OutputFormatter('text');

  test('text list', () => {
    const result = fmt.formatResult('list', ['a', 'b', 'c'], {}, 0);
    expect(result).toBe('a\nb\nc');
  });

  test('text scalar', () => {
    const result = fmt.formatResult('add', 'Memory added', {}, 0);
    expect(result).toBe('Memory added');
  });
});

describe('formatError', () => {
  test('agent error envelope', () => {
    const fmt = new OutputFormatter('agent');
    const scope = { user_id: 'alice' };
    const result = fmt.formatError('search', 'Connection timed out', scope, 5023);
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe('error');
    expect(parsed.command).toBe('search');
    expect(parsed.duration_ms).toBe(5023);
    expect(parsed.scope).toEqual(scope);
    expect(parsed.count).toBe(0);
    expect(parsed.data).toBeNull();
    expect(parsed.error).toBe('Connection timed out');
  });

  test('json error', () => {
    const fmt = new OutputFormatter('json');
    const result = fmt.formatError('add', 'fail', {}, 0);
    expect(JSON.parse(result)).toEqual({ error: 'fail' });
  });

  test('text error', () => {
    const fmt = new OutputFormatter('text');
    const result = fmt.formatError('add', 'something broke', {}, 0);
    expect(result).toBe('Error: something broke');
  });

  test('table error', () => {
    const fmt = new OutputFormatter('table');
    const result = fmt.formatError('list', 'oops', {}, 0);
    expect(result).toBe('Error: oops');
  });

  test('quiet error', () => {
    const fmt = new OutputFormatter('quiet');
    const result = fmt.formatError('delete', 'denied', {}, 0);
    expect(result).toBe('Error: denied');
  });
});
