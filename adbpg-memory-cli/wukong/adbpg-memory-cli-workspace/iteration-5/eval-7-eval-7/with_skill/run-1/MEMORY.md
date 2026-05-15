## Agent 记忆隔离配置
- 使用 adbpg-memory 的 `-a` (agent_id) 参数实现不同 Agent 实例间的记忆隔离。
- 开启隔离需执行：`adbpg-mem agent-config set isolation_agent true -a <agent_id>`。
- 隔离开启后，add/search 操作会自动携带 agent_id，无需手动指定。
- 若未找到 system prompt 中的 agent_id，应向用户询问，严禁使用默认值或虚构 ID。
