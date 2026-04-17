'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.adbpg-mem');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const ENV_PREFIX = 'ADBPG_MEM_';

// Environment variable to config key mapping
const ENV_MAP = {
  ADBPG_MEM_API_MODE: 'api_mode',
  ADBPG_MEM_HOST: 'host',
  ADBPG_MEM_PORT: 'port',
  ADBPG_MEM_USER: 'user',
  ADBPG_MEM_PASSWORD: 'password',
  ADBPG_MEM_DBNAME: 'dbname',
  ADBPG_MEM_REST_API_KEY: 'rest_api_key',
  ADBPG_MEM_REST_BASE_URL: 'rest_base_url',
  ADBPG_MEM_USER_ID: 'user_id',
};

// Required fields per api_mode
const SQL_REQUIRED_FIELDS = ['host', 'port', 'user', 'password', 'dbname'];
const REST_REQUIRED_FIELDS = ['rest_base_url', 'rest_api_key'];

/**
 * Load configuration from the JSON config file.
 * Returns an empty object if the file does not exist.
 * @param {string} [configFile] - Path to config file. Defaults to CONFIG_FILE.
 * @returns {object}
 */
function loadConfig(configFile) {
  const filePath = configFile != null ? configFile : CONFIG_FILE;
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Save configuration to the JSON config file.
 * Creates the config directory if it does not exist.
 * @param {object} config - Configuration object to save.
 * @param {string} [configFile] - Path to config file. Defaults to CONFIG_FILE.
 */
function saveConfig(config, configFile) {
  const filePath = configFile != null ? configFile : CONFIG_FILE;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Load configuration values from environment variables.
 * Only includes env vars that are actually set. Converts port to number.
 * @returns {object}
 */
function _loadEnvConfig() {
  const envConfig = {};
  for (const [envVar, configKey] of Object.entries(ENV_MAP)) {
    const value = process.env[envVar];
    if (value !== undefined) {
      if (configKey === 'port') {
        const parsed = parseInt(value, 10);
        envConfig[configKey] = isNaN(parsed) ? value : parsed;
      } else {
        envConfig[configKey] = value;
      }
    }
  }
  return envConfig;
}

/**
 * Merge configuration from three layers (highest to lowest priority):
 * 1. CLI flags (only non-null/undefined values)
 * 2. Environment variables (only set vars)
 * 3. Config file
 *
 * @param {object} [cliFlags] - CLI flag overrides. null/undefined values are ignored.
 * @param {string} [configFile] - Path to config file. Defaults to CONFIG_FILE.
 * @returns {object} Merged configuration.
 */
function mergeConfig(cliFlags, configFile) {
  // Layer 3: config file (lowest priority)
  const fileConfig = loadConfig(configFile);

  // Layer 2: environment variables
  const envConfig = _loadEnvConfig();

  // Layer 1: CLI flags (highest priority) — filter out null/undefined values
  const cliConfig = {};
  if (cliFlags != null) {
    for (const [k, v] of Object.entries(cliFlags)) {
      if (v != null) {
        cliConfig[k] = v;
      }
    }
  }

  // Merge: file < env < cli
  return Object.assign({}, fileConfig, envConfig, cliConfig);
}

/**
 * Return a copy of config with sensitive fields masked.
 * Any key containing 'password' or 'api_key' will have its value
 * replaced with the first 4 characters followed by '***',
 * or just '***' if the value is 4 characters or fewer.
 * @param {object} config
 * @returns {object}
 */
function maskSensitive(config) {
  const masked = {};
  for (const [key, value] of Object.entries(config)) {
    if (
      (key.includes('password') || key.includes('api_key')) &&
      typeof value === 'string' &&
      value
    ) {
      if (value.length <= 4) {
        masked[key] = '***';
      } else {
        masked[key] = value.slice(0, 4) + '***';
      }
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

/**
 * Validate configuration based on api_mode.
 * SQL mode requires: host, port, user, password, dbname.
 * REST mode requires: rest_base_url, rest_api_key.
 * Empty string or missing counts as invalid.
 *
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateConfig(config) {
  const errors = [];
  const apiMode = config.api_mode || '';

  if (!apiMode) {
    errors.push('api_mode is required');
    return { valid: false, errors };
  }

  if (apiMode !== 'sql' && apiMode !== 'rest') {
    errors.push(`api_mode must be 'sql' or 'rest', got '${apiMode}'`);
    return { valid: false, errors };
  }

  const required = apiMode === 'sql' ? SQL_REQUIRED_FIELDS : REST_REQUIRED_FIELDS;

  for (const field of required) {
    const value = config[field];
    if (value === undefined || value === null || (typeof value === 'string' && value === '')) {
      errors.push(`'${field}' is required for ${apiMode} mode`);
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  CONFIG_DIR,
  CONFIG_FILE,
  ENV_PREFIX,
  ENV_MAP,
  SQL_REQUIRED_FIELDS,
  REST_REQUIRED_FIELDS,
  loadConfig,
  saveConfig,
  mergeConfig,
  maskSensitive,
  validateConfig,
  _loadEnvConfig,
};
