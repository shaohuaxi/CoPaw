# ADBPG Memory CLI (Python)

Command-line tool for managing ADBPG long-term memory.

## Per-agent configuration (`agent-config`)

Per-agent isolation state lives at `~/.adbpg-mem/agents/<agent_id>.json` (mode 0600, parent dir auto-created on first write). This is distinct from the system-level `~/.adbpg-mem/config.json` (connection info, shared across the host).

Schema fields:

| field | type | default | meaning |
|-------|------|---------|---------|
| `isolation_agent` | boolean | `false` | Whether this agent's memories are isolated by `agent_id` (CLI add/search will inject `-a`) |
| `isolation_run_mode` | enum | `off` | Run/session isolation mode: `off` / `manual` / `auto` / `tag` |
| `current_run_id` | string | (unset) | Currently active `run_id` when mode is `manual` or `auto` |

Subcommands (all require `-a <agent_id>`):

```bash
adbpg-mem agent-config set   <key> <value>  -a <agent_id>
adbpg-mem agent-config get   <key>          -a <agent_id>
adbpg-mem agent-config show                 -a <agent_id>
adbpg-mem agent-config unset <key>          -a <agent_id>
```

Example:

```bash
# Turn on agent isolation for agent xK3mNp
adbpg-mem agent-config set isolation_agent true -a xK3mNp

# Switch session isolation to "manual" mode
adbpg-mem agent-config set isolation_run_mode manual -a xK3mNp

# Pin the current run id
adbpg-mem agent-config set current_run_id "项目-重构讨论" -a xK3mNp

# Inspect the full state (returns defaults if the file does not exist)
adbpg-mem agent-config show -a xK3mNp

# Clear the current run id (idempotent: ok even if not set)
adbpg-mem agent-config unset current_run_id -a xK3mNp
```

`show` on a missing agent returns `status=ok` with default values; `unset` of a missing key is a no-op (`status=ok`).
