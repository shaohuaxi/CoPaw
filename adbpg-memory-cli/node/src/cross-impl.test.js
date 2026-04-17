'use strict';

/**
 * Cross-implementation property tests for ADBPG Memory CLI.
 *
 * Verifies that the Node.js OutputFormatter in agent mode produces JSON output
 * matching the cross-implementation contract shared with the Python implementation.
 *
 * Feature: adbpg-memory-cli, Property 14: 跨实现 Agent JSON 输出一致性
 */

const fc = require('fast-check');
const { OutputFormatter } = require('./output');

// Expected field order for success envelope
const SUCCESS_FIELDS = ['status', 'command', 'duration_ms', 'scope', 'count', 'data'];

// Expected field order for error envelope
const ERROR_FIELDS = ['status', 'command', 'duration_ms', 'scope', 'count', 'data', 'error'];

// Arbitraries
const commandArb = fc.constantFrom('add', 'search', 'list', 'delete', 'config', 'status');

const safeTextArb = fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes('\0'));

const scopeArb = fc.record({
  user_id: safeTextArb,
  agent_id: safeTextArb,
  run_id: safeTextArb,
});

const durationMsArb = fc.integer({ min: 0, max: 100000 });

const countArb = fc.integer({ min: 0, max: 10000 });

const jsonDataArb = fc.jsonValue({ maxDepth: 2 });

// ---------------------------------------------------------------------------
// Property 14: 跨实现 Agent JSON 输出一致性 — Success envelope
// ---------------------------------------------------------------------------

// Feature: adbpg-memory-cli, Property 14: 跨实现 Agent JSON 输出一致性
describe('Cross-implementation Agent JSON output consistency', () => {
  /**
   * **Validates: Requirements 1.11, 13.5**
   */
  test('success envelope field names and order match contract', () => {
    fc.assert(
      fc.property(
        commandArb,
        jsonDataArb,
        scopeArb,
        durationMsArb,
        countArb,
        (command, data, scope, durationMs, count) => {
          const fmt = new OutputFormatter('agent');
          const output = fmt.formatResult(command, data, scope, durationMs, count);
          const parsed = JSON.parse(output);

          // Field names must match exactly in order
          const keys = Object.keys(parsed);
          expect(keys).toEqual(SUCCESS_FIELDS);

          // Field types must match the contract
          expect(parsed.status).toBe('ok');
          expect(typeof parsed.command).toBe('string');
          expect(typeof parsed.duration_ms).toBe('number');
          expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
          expect(typeof parsed.scope).toBe('object');
          expect(parsed.scope).not.toBeNull();
          expect(typeof parsed.count).toBe('number');
          expect(parsed.count).toBeGreaterThanOrEqual(0);
          // data can be any JSON value — just verify key exists
          expect('data' in parsed).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ---------------------------------------------------------------------------
  // Property 14: 跨实现 Agent JSON 输出一致性 — Error envelope
  // ---------------------------------------------------------------------------

  /**
   * **Validates: Requirements 1.11, 13.5**
   */
  test('error envelope field names and order match contract', () => {
    fc.assert(
      fc.property(
        commandArb,
        safeTextArb,
        scopeArb,
        durationMsArb,
        (command, errorMsg, scope, durationMs) => {
          const fmt = new OutputFormatter('agent');
          const output = fmt.formatError(command, errorMsg, scope, durationMs);
          const parsed = JSON.parse(output);

          // Field names must match exactly in order
          const keys = Object.keys(parsed);
          expect(keys).toEqual(ERROR_FIELDS);

          // Field types must match the contract
          expect(parsed.status).toBe('error');
          expect(typeof parsed.command).toBe('string');
          expect(typeof parsed.duration_ms).toBe('number');
          expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
          expect(typeof parsed.scope).toBe('object');
          expect(parsed.scope).not.toBeNull();
          expect(parsed.count).toBe(0);
          expect(parsed.data).toBeNull();
          expect(typeof parsed.error).toBe('string');
        }
      ),
      { numRuns: 100 }
    );
  });
});
