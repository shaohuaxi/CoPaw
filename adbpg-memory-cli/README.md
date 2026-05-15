# adbpg-memory-cli

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen.svg)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/python-%E2%89%A53.10-brightgreen.svg)](https://www.python.org/)
[![Quality eval](https://img.shields.io/badge/quality_eval-84.8%25-success.svg)](./wukong/docs/skill-craft%E8%AF%84%E6%B5%8B%E7%BB%8F%E9%AA%8C%E6%80%BB%E7%BB%93.md)
[![Cross-impl parity](https://img.shields.io/badge/Node%E2%87%84Python-16%2F16-success.svg)](#评测与质量)
[![Skill](https://img.shields.io/badge/skill-adbpg--memory-purple.svg)](./SKILL.md)

基于 AnalyticDB for PostgreSQL 的 AI Agent 长期记忆 CLI 工具 + Skill 包。把对话中的事实提取、向量化、存储，让 Agent 拥有跨会话的持久记忆，支持 user / agent / session 三维隔离。

适用场景：
- AI Agent 跨会话保留用户偏好、个人信息、历史决策
- 多 Agent / 多会话的记忆隔离
- 个性化推荐、历史回忆、偏好查询
- 多商家 SaaS 场景的两级记忆隔离（商家公共 + 用户私有）

## 30 秒快速验证

如果你已经有一个能用的 ADBPG Memory REST 服务，3 条命令验证整条链路：

```bash
# 1. 配置（一次性，写入 ./.adbpg-mem/config.json）
node ./scripts/adbpg-mem.mjs config init "https://your-server.com" "sk-xxxxx"

# 2. 写入一条记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 node ./scripts/adbpg-mem.mjs add "用户喜欢芒果" --agent

# 3. 检索验证（等 2-3 秒让异步写入落库）
NODE_TLS_REJECT_UNAUTHORIZED=0 node ./scripts/adbpg-mem.mjs search "水果偏好" --agent
```

第 3 条返回的 JSON `data` 数组里能看到刚存的事实，就证明 skill 真的在工作。详细对接见下文。

# 目录结构

```
adbpg-memory-cli/
├── SKILL.md                  # ★ 当前生效的 Skill 契约（平台无关，REST 模式优先）
├── scripts/                  # 沙箱专用零依赖运行时
│   ├── adbpg-mem.mjs         #   单文件 ESM 脚本（Node 18+，无 npm install）
│   └── adbpg-mem.test.mjs    #   48 个 node:test 单元测试
├── shared/                   # 跨实现共享 schema
│   ├── config-schema.json            #   全局连接配置（rest_base_url / api_key 等）
│   ├── agent-config-schema.json      #   per-agent 隔离配置
│   ├── config.example.rest.json      #   REST 模式样例
│   └── config.example.sql.json       #   SQL 模式样例
├── node/                     # Node.js 完整 CLI 实现（npm 全局安装路径）
│   └── src/                  #   cli / client / config / agent-config / output
├── python/                   # Python 完整 CLI 实现（pip 全局安装路径）
│   └── src/adbpg_memory_cli/
├── evals/                    # 评测用例
│   ├── evals.json            #   8 条 quality eval（存储 / 检索 / 隔离）
│   └── trigger_evals.json    #   19 条 trigger eval（9 正例 + 10 near-miss 反例）
├── examples/
│   └── saas-ecommerce/       # 多商家 SaaS 模式（电商 ERP / 聚水潭类）独立示例
├── Copaw/                    # ★ CoPaw 历史快照
│   ├── SKILL.md              #   原始版（PROFILE.md 落盘，依赖全局 CLI）
│   ├── 集成指南.md            #   ADBPG × CoPaw 集成指南
│   └── TEST_PLAN.md          #   CoPaw 端到端测试计划
├── wukong/                   # ★ Wukong / 钉钉助手部署专区
│   ├── adbpg-memory.zip      #   最小可发布 ZIP（21 KB）
│   ├── adbpg-memory-skill-pkg/  # 5 文件 staging 目录
│   ├── adbpg-memory-cli-workspace/  # 评测产物 iter1-9
│   └── docs/
│       ├── 对接Wukong.md            # Wukong 完整对接指南 + 端到端测试
│       └── skill-craft评测经验总结.md  # 用 skill-craft 写评测的方法论
└── docs/                     # 通用平台无关文档（待补充）
```

# 三种使用路径

## 1. 沙箱场景（Wukong / 钉钉助手 / 任何带 Node 18+ 的隔离环境）

直接用 `scripts/adbpg-mem.mjs`，零依赖单文件 ESM，跟 SKILL.md 一起打 ZIP 部署：

```bash
node ./scripts/adbpg-mem.mjs config init "https://your-server.com" "sk-xxxxx"
node ./scripts/adbpg-mem.mjs add "用户喜欢芒果" --agent
node ./scripts/adbpg-mem.mjs search "水果偏好" --agent
```

详见：[wukong/docs/对接Wukong.md](./wukong/docs/对接Wukong.md)

## 2. 本地终端（Node 全局 CLI）

```bash
cd node && npm install && npm link
adbpg-mem init                              # 交互式配置
adbpg-mem add "用户喜欢芒果" --agent
adbpg-mem search "水果偏好" --agent
```

## 3. 本地终端（Python 全局 CLI）

```bash
cd python && pip install -e .
adbpg-mem init
adbpg-mem add "用户喜欢芒果" --agent
adbpg-mem search "水果偏好" --agent
```

Node 和 Python 实现命令名、参数、输出格式完全一致，二者读取相同的 `~/.adbpg-mem/config.json`。

# Skill 契约（SKILL.md）核心能力

| 能力 | 命令 |
|---|---|
| **存储事实** | `add "<提炼后的事实>"` 或 `add --json-messages '<json>'` |
| **语义检索** | `search "<自然语言查询>"`（按 score 降序）|
| **列出全部** | `list` |
| **三维隔离** | `-u <user_id>`、`-a <agent_id>`、`-r <run_id>` 任意组合 |
| **per-agent 持久配置** | `agent-config set/get/show/unset -a <agent_id>` |
| **沙箱 bootstrap** | `config init <url> <key>`（写入 workspace 持久路径）|
| **状态检测** | `status --agent` |

详见仓库根 [SKILL.md](./SKILL.md)。

# 评测与质量

`evals/` 下有 8 条 quality eval 和 19 条 trigger eval，已在 Wukong 沙箱实测：
- **Quality 通过率**：84.8% (28/33)
- **静态质量分**：0.58 / 阈值 0.50（达标）
- **跨实现 (Node + Python) 行为对齐**：16/16 case 一致

完整评测方法论：[wukong/docs/skill-craft评测经验总结.md](./wukong/docs/skill-craft评测经验总结.md)

# 平台对接清单

| 平台 | 状态 | 入口文档 |
|---|---|---|
| Wukong / 钉钉助手 | ✅ 已实测 84.8% Quality | [wukong/docs/对接Wukong.md](./wukong/docs/对接Wukong.md) |
| CoPaw | ⚠️ 早期 v0.1 实测过；当前用 CLI 自管理后未重测 | [Copaw/集成指南.md](./Copaw/集成指南.md) |
| 本地终端（Node / Python）| ✅ 端到端可用 | 见上文「使用路径 2 / 3」|
| Claude Code / Cursor | ✅ 机制兼容（理论 OK） | 同沙箱场景，参考 Wukong 文档 |

# 设计要点（一句话）

**SKILL.md 在机制层平台无关**：
- 通过 skill 自带的 `scripts/adbpg-mem.mjs` 执行（不依赖全局 CLI 安装）
- 三级 config fallback（env > workspace cwd > 用户 home）适配不同沙箱模型
- per-agent 状态由 CLI 自管理（不依赖任何平台 profile 文件）
- PENDING 异步状态透传 + agent 端 sleep + verify 流程

# 项目链接

- 仓库：https://github.com/shaohuaxi/CoPaw/tree/dev_adbpg_skills/adbpg-memory-cli
- ADBPG Memory REST 服务：商业版 ADBPG / 内部部署
- License：Apache-2.0
