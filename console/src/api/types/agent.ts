/** Agent query request payload sent to the backend runner. */
export interface AgentRequest {
  input: unknown;
  session_id?: string | null;
  user_id?: string | null;
  channel?: string | null;
  [key: string]: unknown;
}

/** Agent runtime behaviour configuration (mirrors Python AgentsRunningConfig). */
export interface AgentsRunningConfig {
  max_iters: number;
  llm_retry_enabled: boolean;
  llm_max_retries: number;
  llm_backoff_base: number;
  llm_backoff_cap: number;
  max_input_length: number;
  memory_compact_ratio: number;
  memory_reserve_ratio: number;
  tool_result_compact_recent_n: number;
  tool_result_compact_old_threshold: number;
  tool_result_compact_recent_threshold: number;
  tool_result_compact_retention_days: number;
}

/**
 * ADBPG (AnalyticDB for PostgreSQL) connection and LLM/Embedding
 * configuration.  Mirrors the Python ``ADBPGConnectionConfig`` model
 * so that connection details can be persisted in agent.json via the
 * console UI instead of relying on environment variables.
 */
export interface ADBPGConnectionConfig {
  // --- Database connection ---
  host: string;
  port: number;
  user: string;
  password: string;
  dbname: string;
  // --- LLM configuration (used by adbpg_llm_memory) ---
  llm_model: string;
  llm_api_key: string;
  llm_base_url: string;
  // --- Embedding configuration ---
  embedding_model: string;
  embedding_api_key: string;
  embedding_base_url: string;
  embedding_dims: number;
  // --- Optional tuning ---
  /** HNSW index configuration string (optional). */
  hnsw?: string | null;
  /** Memory search timeout in seconds (default 10.0). */
  search_timeout: number;
  // --- Connection pool tuning ---
  /** Minimum connections in the shared pool (default 2). */
  pool_minconn: number;
  /** Maximum connections in the shared pool (default 10). */
  pool_maxconn: number;
  // --- Tool result compaction ---
  /** Compaction mode: 'summarize' (LLM) or 'truncate' (default 'summarize'). */
  tool_compact_mode: string;
  /** Max character length after tool output compaction (default 500). */
  tool_compact_max_len: number;
  // --- Memory isolation ---
  /** When false (default), all agents share memory. When true, each agent's memory is isolated. */
  memory_isolation: boolean;
  // --- API mode ---
  /** API mode: 'sql' (default, direct ADBPG SQL) or 'rest' (mem0 REST API). */
  api_mode: string;
  /** mem0 REST API key (required when api_mode='rest'). */
  rest_api_key: string;
  /** mem0 REST API base URL (default: https://api.mem0.ai). */
  rest_base_url: string;
}

/**
 * Per-agent memory manager configuration.
 *
 * `backend` selects the memory implementation:
 * - `"local"` – ReMeLight-based local memory (default)
 * - `"adbpg"` – AnalyticDB for PostgreSQL long-term memory
 *
 * When `backend` is `"adbpg"`, the `adbpg` field must contain valid
 * connection details.
 */
export interface MemoryManagerConfig {
  backend: string;
  adbpg: ADBPGConnectionConfig;
  /** When true, strip local-file memory instructions from AGENTS.md system prompt. */
  strip_local_memory_instructions: boolean;
}
