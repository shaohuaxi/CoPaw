'use strict';

/**
 * Output formatting for ADBPG Memory CLI.
 *
 * Supports five output modes: text, json, table, quiet, agent.
 * Provides unified formatting for command results and errors.
 */

const VALID_MODES = ['text', 'json', 'table', 'quiet', 'agent'];

/**
 * Truncate text to maxLength characters.
 *
 * If text is longer than maxLength, truncate and append '...'
 * The truncated portion (before the ellipsis) is at most maxLength characters.
 * If text is maxLength or shorter, return as-is.
 *
 * @param {string} text
 * @param {number} [maxLength=80]
 * @returns {string}
 */
function truncateContent(text, maxLength = 80) {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}

class OutputFormatter {
  /**
   * @param {string} [mode='text']
   */
  constructor(mode = 'text') {
    if (!VALID_MODES.includes(mode)) {
      throw new Error(
        `Invalid output mode: '${mode}'. Must be one of ${VALID_MODES.join(', ')}`
      );
    }
    this.mode = mode;
  }

  /**
   * True for json, agent, quiet modes (suppress interactive elements).
   * @returns {boolean}
   */
  get isMachine() {
    return ['json', 'agent', 'quiet'].includes(this.mode);
  }

  /**
   * Format output based on current mode.
   *
   * @param {string} command
   * @param {*} data
   * @param {Object} scope
   * @param {number} durationMs
   * @param {number|null} [count=null]
   * @returns {string}
   */
  formatResult(command, data, scope, durationMs, count = null) {
    if (this.mode === 'agent') {
      return this._formatAgentEnvelope(command, data, scope, durationMs, count);
    } else if (this.mode === 'json') {
      return JSON.stringify(data);
    } else if (this.mode === 'quiet') {
      return this._formatQuiet(data, count);
    } else if (this.mode === 'table') {
      return this._formatTable(data);
    } else {
      return this._formatText(data);
    }
  }

  /**
   * Format error output. In agent mode, returns JSON envelope with status=error.
   *
   * @param {string} command
   * @param {string} error
   * @param {Object} scope
   * @param {number} durationMs
   * @returns {string}
   */
  formatError(command, error, scope, durationMs) {
    if (this.mode === 'agent') {
      return JSON.stringify({
        status: 'error',
        command: command,
        duration_ms: durationMs,
        scope: scope,
        count: 0,
        data: null,
        error: error,
      });
    } else if (this.mode === 'json') {
      return JSON.stringify({ error: error });
    } else {
      return `Error: ${error}`;
    }
  }

  /**
   * Generate agent mode JSON envelope.
   *
   * @param {string} command
   * @param {*} data
   * @param {Object} scope
   * @param {number} durationMs
   * @param {number|null} count
   * @returns {string}
   */
  _formatAgentEnvelope(command, data, scope, durationMs, count) {
    return JSON.stringify({
      status: 'ok',
      command: command,
      duration_ms: durationMs,
      scope: scope,
      count: count,
      data: data,
    });
  }

  /**
   * @param {*} data
   * @param {number|null} count
   * @returns {string}
   */
  _formatQuiet(data, count) {
    if (count !== null && count !== undefined) {
      return String(count);
    }
    if (Array.isArray(data)) {
      return data
        .filter((item) => typeof item === 'object' && item !== null)
        .map((item) => String(item.id || ''))
        .join('\n');
    }
    return String(data);
  }

  /**
   * @param {*} data
   * @returns {string}
   */
  _formatTable(data) {
    if (!Array.isArray(data) || data.length === 0) {
      return Array.isArray(data) ? '[]' : String(data);
    }
    const first = data[0];
    if (typeof first !== 'object' || first === null) {
      return String(data);
    }
    const headers = Object.keys(first);
    if (headers.length === 0) {
      return String(data);
    }
    const lines = [];
    lines.push(headers.join(' | '));
    lines.push(headers.map((h) => '-'.repeat(h.length)).join(' | '));
    for (const row of data) {
      lines.push(headers.map((h) => String(row[h] !== undefined ? row[h] : '')).join(' | '));
    }
    return lines.join('\n');
  }

  /**
   * @param {*} data
   * @returns {string}
   */
  _formatText(data) {
    if (Array.isArray(data)) {
      return data.map((item) => String(item)).join('\n');
    }
    return String(data);
  }
}

module.exports = {
  VALID_MODES,
  truncateContent,
  OutputFormatter,
};
