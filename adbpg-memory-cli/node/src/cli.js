'use strict';

/**
 * ADBPG Memory CLI — manage ADBPG long-term memory from the command line.
 *
 * Main entry point using commander. Implements all commands:
 * init, add, search, list, delete, config (show/set/path), status, version.
 */

const { Command } = require('commander');
const fs = require('fs');
const readline = require('readline');

const { ADBPGMemoryCLIClient, parseJsonMessages, textToMessages } = require('./client');
const {
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  mergeConfig,
  maskSensitive,
} = require('./config');
const { OutputFormatter } = require('./output');

const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective output mode from commander options.
 * --agent flag overrides, then --json flag, then -o value.
 */
function _resolveOutputMode(opts) {
  if (opts.agent) return 'agent';
  if (opts.json) return 'json';
  return opts.output || 'text';
}

/**
 * Build scope object from global options and merged config.
 */
function _buildScope(opts, config) {
  return {
    user_id: opts.userId || config.user_id || 'default',
    agent_id: opts.agentId || '',
    run_id: opts.runId || '',
  };
}

/**
 * Build merged config from global options.
 */
function _buildConfig(opts) {
  const cliFlags = {};
  if (opts.userId != null) cliFlags.user_id = opts.userId;
  if (opts.agentId != null) cliFlags.agent_id = opts.agentId;
  if (opts.runId != null) cliFlags.run_id = opts.runId;
  return mergeConfig(cliFlags);
}

/**
 * Format and write a successful result to stdout.
 */
function _echoResult(formatter, command, data, scope, durationMs, count) {
  const output = formatter.formatResult(command, data, scope, durationMs, count != null ? count : null);
  process.stdout.write(output + '\n');
}

/**
 * Format and write an error result to stderr.
 */
function _echoError(formatter, command, error, scope, durationMs) {
  const output = formatter.formatError(command, error, scope, durationMs);
  process.stderr.write(output + '\n');
}

/**
 * Interactive prompt using readline. Returns a promise.
 */
function _prompt(rl, promptText, defaultValue) {
  return new Promise((resolve) => {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${promptText}${suffix}: `, (answer) => {
      const trimmed = (answer || '').trim();
      resolve(trimmed || defaultValue || '');
    });
  });
}

/**
 * Prompt for a required value, re-prompting if empty and no default.
 */
async function _promptRequired(rl, promptText, defaultValue) {
  while (true) {
    const value = await _prompt(rl, promptText, defaultValue);
    if (value) return value;
    process.stdout.write('  This field is required. Please enter a value.\n');
  }
}

/**
 * Prompt for confirmation (y/N). Returns boolean.
 */
function _confirm(rl, message) {
  return new Promise((resolve) => {
    rl.question(`${message} [y/N]: `, (answer) => {
      const trimmed = (answer || '').trim().toLowerCase();
      resolve(trimmed === 'y' || trimmed === 'yes');
    });
  });
}

/**
 * Read all of stdin as a string.
 */
function _readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}


// ---------------------------------------------------------------------------
// Program setup
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name('adbpg-mem')
  .description('ADBPG Memory CLI — manage ADBPG long-term memory')
  .version(VERSION, '--version', 'Show version number')
  .option('-o, --output <format>', 'Output format: text, json, table, quiet, agent', 'text')
  .option('--json', 'Shortcut for -o json')
  .option('--agent', 'Shortcut for -o agent')
  .option('-u, --user-id <id>', 'User ID scope')
  .option('-a, --agent-id <id>', 'Agent ID scope')
  .option('-r, --run-id <id>', 'Run ID scope');

// Validate --output choice
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  const validModes = ['text', 'json', 'table', 'quiet', 'agent'];
  if (opts.output && !validModes.includes(opts.output)) {
    process.stderr.write(
      `Error: Invalid output format '${opts.output}'. Must be one of ${validModes.join(', ')}\n`
    );
    process.exit(2);
  }
});

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

program
  .command('init')
  .description('Interactive configuration wizard')
  .action(async () => {
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    if (formatter.isMachine) {
      _echoError(
        formatter,
        'init',
        'init command requires interactive mode (not available with --json/--agent/--quiet)',
        scope,
        0
      );
      process.exit(2);
    }

    const existing = loadConfig();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      process.stdout.write('ADBPG Memory CLI — Configuration Wizard\n');
      process.stdout.write('='.repeat(42) + '\n');

      // api_mode
      let apiMode;
      while (true) {
        apiMode = await _prompt(rl, 'API mode (sql/rest)', existing.api_mode || 'sql');
        if (apiMode === 'sql' || apiMode === 'rest') break;
        process.stdout.write('  Please enter "sql" or "rest".\n');
      }

      const newConfig = { api_mode: apiMode };

      if (apiMode === 'sql') {
        newConfig.host = await _promptRequired(rl, 'Database host', existing.host);
        const portStr = await _prompt(rl, 'Database port', String(existing.port || 5432));
        newConfig.port = parseInt(portStr, 10) || 5432;
        newConfig.user = await _promptRequired(rl, 'Database user', existing.user);
        newConfig.password = await _promptRequired(rl, 'Database password', existing.password);
        newConfig.dbname = await _promptRequired(rl, 'Database name', existing.dbname);
        newConfig.llm_model = await _prompt(rl, 'LLM model', existing.llm_model || '');
        newConfig.llm_api_key = await _prompt(rl, 'LLM API key', existing.llm_api_key || '');
        newConfig.llm_base_url = await _prompt(rl, 'LLM base URL', existing.llm_base_url || '');
        newConfig.embedding_model = await _prompt(rl, 'Embedding model', existing.embedding_model || '');
        newConfig.embedding_api_key = await _prompt(rl, 'Embedding API key', existing.embedding_api_key || '');
        newConfig.embedding_base_url = await _prompt(rl, 'Embedding base URL', existing.embedding_base_url || '');
        const dimsStr = await _prompt(rl, 'Embedding dims', String(existing.embedding_dims || 1024));
        newConfig.embedding_dims = parseInt(dimsStr, 10) || 1024;
      } else {
        newConfig.rest_base_url = await _promptRequired(rl, 'REST base URL', existing.rest_base_url);
        newConfig.rest_api_key = await _promptRequired(rl, 'REST API key', existing.rest_api_key);
      }

      newConfig.user_id = await _prompt(rl, 'Default user ID', existing.user_id || 'default');

      saveConfig(newConfig);
      process.stdout.write(`\nConfiguration saved to ${CONFIG_FILE}\n`);
    } finally {
      rl.close();
    }
  });


// ---------------------------------------------------------------------------
// add command
// ---------------------------------------------------------------------------

program
  .command('add [text]')
  .description("Add a memory. Pass text directly, use '-' for stdin, or --file/--json-messages.")
  .option('--file <path>', 'Read text from file')
  .option('--json-messages <json>', 'JSON array of messages')
  .option('--metadata <json>', 'JSON metadata to attach')
  .option('--memory-type <type>', 'Memory type (e.g. procedural_memory)')
  .option('--prompt <prompt>', 'Custom fact extraction prompt (SQL mode only)')
  .action(async (text, cmdOpts) => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    // Resolve messages
    let messages;
    try {
      if (cmdOpts.jsonMessages) {
        messages = parseJsonMessages(cmdOpts.jsonMessages);
      } else if (cmdOpts.file) {
        const content = fs.readFileSync(cmdOpts.file, 'utf-8');
        messages = textToMessages(content);
      } else if (text === '-') {
        const content = await _readStdin();
        messages = textToMessages(content);
      } else if (text) {
        messages = textToMessages(text);
      } else {
        _echoError(
          formatter,
          'add',
          "No input provided. Pass text, use '-' for stdin, --file, or --json-messages.",
          scope,
          Date.now() - t0
        );
        process.exit(2);
      }
    } catch (e) {
      _echoError(formatter, 'add', e.message, scope, Date.now() - t0);
      process.exit(2);
    }

    // Parse metadata
    let meta = null;
    if (cmdOpts.metadata) {
      try {
        meta = JSON.parse(cmdOpts.metadata);
      } catch (e) {
        _echoError(formatter, 'add', `Invalid metadata JSON: ${e.message}`, scope, Date.now() - t0);
        process.exit(2);
      }
    }

    if (cmdOpts.memoryType) {
      if (meta === null) meta = {};
      meta.memory_type = cmdOpts.memoryType;
    }

    // Warn if --prompt used in REST mode
    let promptVal = cmdOpts.prompt || null;
    if (promptVal && config.api_mode === 'rest') {
      if (!formatter.isMachine) {
        process.stderr.write(
          'Warning: --prompt (custom fact extraction) is only available in SQL mode. The flag will be ignored.\n'
        );
      }
      promptVal = null;
    }

    try {
      const client = new ADBPGMemoryCLIClient(config);
      const result = await client.add(messages, {
        userId: scope.user_id,
        agentId: scope.agent_id || undefined,
        runId: scope.run_id || undefined,
        metadata: meta,
        prompt: promptVal,
      });
      const durationMs = Date.now() - t0;
      _echoResult(formatter, 'add', result, scope, durationMs);
    } catch (e) {
      const durationMs = Date.now() - t0;
      _echoError(formatter, 'add', e.message, scope, durationMs);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// search command
// ---------------------------------------------------------------------------

program
  .command('search <query>')
  .description('Semantic search for memories')
  .option('--limit <n>', 'Max results to return', '5')
  .action(async (query, cmdOpts) => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    const limit = parseInt(cmdOpts.limit, 10) || 5;

    try {
      const client = new ADBPGMemoryCLIClient(config);
      const results = await client.search(query, {
        userId: scope.user_id,
        agentId: scope.agent_id || undefined,
        runId: scope.run_id || undefined,
        limit,
      });

      const durationMs = Date.now() - t0;

      if (!results.length && !formatter.isMachine) {
        process.stdout.write('No matching memories found.\n');
        return;
      }

      _echoResult(formatter, 'search', results, scope, durationMs, results.length);
    } catch (e) {
      const durationMs = Date.now() - t0;
      const errorMsg = e.message || String(e);
      if (/timeout|cancel/i.test(errorMsg)) {
        _echoError(formatter, 'search', `Search timed out: ${errorMsg}`, scope, durationMs);
      } else {
        _echoError(formatter, 'search', errorMsg, scope, durationMs);
      }
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// list command
// ---------------------------------------------------------------------------

program
  .command('list')
  .description('List all memories for the current scope')
  .action(async () => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    try {
      const client = new ADBPGMemoryCLIClient(config);
      const results = await client.listAll({
        userId: scope.user_id,
        agentId: scope.agent_id || undefined,
        runId: scope.run_id || undefined,
      });

      const durationMs = Date.now() - t0;

      if (!results.length && !formatter.isMachine) {
        process.stdout.write('No memories found for this scope.\n');
        return;
      }

      _echoResult(formatter, 'list', results, scope, durationMs, results.length);
    } catch (e) {
      const durationMs = Date.now() - t0;
      _echoError(formatter, 'list', e.message, scope, durationMs);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// delete command
// ---------------------------------------------------------------------------

program
  .command('delete')
  .description('Delete all memories for the current scope')
  .requiredOption('--all', 'Delete all memories for scope')
  .option('--force', 'Skip confirmation prompt')
  .action(async (cmdOpts) => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    if (!cmdOpts.force && !formatter.isMachine) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        const confirmed = await _confirm(
          rl,
          `Delete ALL memories for scope user_id=${scope.user_id}?`
        );
        if (!confirmed) {
          process.stdout.write('Cancelled.\n');
          return;
        }
      } finally {
        rl.close();
      }
    }

    try {
      const client = new ADBPGMemoryCLIClient(config);
      const result = await client.deleteAll({
        userId: scope.user_id,
        agentId: scope.agent_id || undefined,
        runId: scope.run_id || undefined,
      });
      const durationMs = Date.now() - t0;
      _echoResult(formatter, 'delete', result, scope, durationMs);
    } catch (e) {
      const durationMs = Date.now() - t0;
      _echoError(formatter, 'delete', e.message, scope, durationMs);
      process.exit(1);
    }
  });


// ---------------------------------------------------------------------------
// config subcommand group
// ---------------------------------------------------------------------------

const configCmd = program
  .command('config')
  .description('View and manage configuration');

configCmd
  .command('show')
  .description('Display current configuration with sensitive fields masked')
  .action(async () => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    const raw = loadConfig();
    if (!raw || Object.keys(raw).length === 0) {
      if (formatter.isMachine) {
        _echoError(
          formatter,
          'config show',
          "No configuration file found. Run 'adbpg-mem init' to create one.",
          scope,
          Date.now() - t0
        );
      } else {
        process.stdout.write("No configuration file found. Run 'adbpg-mem init' to create one.\n");
      }
      process.exit(2);
    }

    const masked = maskSensitive(raw);
    const durationMs = Date.now() - t0;
    _echoResult(formatter, 'config show', masked, scope, durationMs);
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value')
  .action(async (key, value) => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    const raw = loadConfig();

    // Try to convert numeric values
    let converted;
    const asInt = parseInt(value, 10);
    if (!isNaN(asInt) && String(asInt) === value) {
      converted = asInt;
    } else {
      const asFloat = parseFloat(value);
      if (!isNaN(asFloat) && String(asFloat) === value) {
        converted = asFloat;
      } else {
        converted = value;
      }
    }

    raw[key] = converted;
    saveConfig(raw);
    const durationMs = Date.now() - t0;

    if (formatter.isMachine) {
      _echoResult(formatter, 'config set', { key, value: converted }, scope, durationMs);
    } else {
      process.stdout.write(`Set '${key}' = ${JSON.stringify(converted)}\n`);
    }
  });

configCmd
  .command('path')
  .description('Show the configuration file path')
  .action(async () => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);
    const durationMs = Date.now() - t0;

    if (formatter.isMachine) {
      _echoResult(formatter, 'config path', { path: CONFIG_FILE }, scope, durationMs);
    } else {
      process.stdout.write(CONFIG_FILE + '\n');
    }
  });

// ---------------------------------------------------------------------------
// status command
// ---------------------------------------------------------------------------

program
  .command('status')
  .description('Test connection to ADBPG')
  .action(async () => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);

    try {
      const client = new ADBPGMemoryCLIClient(config);
      const { success, message } = await client.testConnection();
      const durationMs = Date.now() - t0;

      if (success) {
        _echoResult(formatter, 'status', { connected: true, message }, scope, durationMs);
      } else {
        _echoError(formatter, 'status', message, scope, durationMs);
        process.exit(1);
      }
    } catch (e) {
      const durationMs = Date.now() - t0;
      _echoError(formatter, 'status', e.message, scope, durationMs);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// version command
// ---------------------------------------------------------------------------

program
  .command('version')
  .description('Show the CLI version')
  .action(async () => {
    const t0 = Date.now();
    const opts = program.opts();
    const outputMode = _resolveOutputMode(opts);
    const formatter = new OutputFormatter(outputMode);
    const config = _buildConfig(opts);
    const scope = _buildScope(opts, config);
    const durationMs = Date.now() - t0;

    if (formatter.isMachine) {
      _echoResult(formatter, 'version', { version: VERSION }, scope, durationMs);
    } else {
      process.stdout.write(`adbpg-mem ${VERSION}\n`);
    }
  });

module.exports = { program };
