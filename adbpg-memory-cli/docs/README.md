# ADBPG 长期记忆 × CoPaw 集成指南

通过 SKILL.md 引导 AI Agent 调用 adbpg-mem CLI 实现长期记忆的存储与检索，支持 user/agent/session 三维隔离，适用于 CoPaw 等个人助手场景，也可扩展至 OpenClaw 等其他 Agent 平台。

## 目录

- [架构概览](#架构概览)
- [前置条件](#前置条件)
- [安装 adbpg-mem CLI](#安装-adbpg-mem-cli)
- [配置记忆服务](#配置记忆服务)
- [部署 Skill 到 CoPaw](#部署-skill-到-copaw)
- [验证集成](#验证集成)
- [工作原理](#工作原理)
- [记忆隔离](#记忆隔离)
- [与本地文件记忆的协作](#与本地文件记忆的协作)
- [扩展到其他 Agent 平台](#扩展到其他-agent-平台)
- [常见问题](#常见问题)

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│  CoPaw Agent                                        │
│                                                     │
│  System Prompt                                      │
│  ├── AGENTS.md (行为指南)                            │
│  ├── SOUL.md (身份原则)                              │
│  ├── PROFILE.md (用户画像)                            │
│  └── skills/adbpg_memory/SKILL.md (记忆行为引导)     │
│                                                     │
│  Tools                                              │
│  └── execute_shell_command ──→ adbpg-mem CLI         │
└──────────────────────────┬──────────────────────────┘
                           │ shell 调用
                           ▼
┌─────────────────────────────────────────────────────┐
│  adbpg-mem CLI                                      │
│  ├── add    (存储记忆)                               │
│  ├── search (语义检索)                               │
│  ├── list   (列出记忆)                               │
│  └── config (管理配置)                               │
└──────────────────────────┬──────────────────────────┘
                           │ REST API / SQL
                           ▼
┌─────────────────────────────────────────────────────┐
│  ADBPG Memory Service                               │
│  (AnalyticDB for PostgreSQL)                        │
│  ├── 事实提取 (LLM)                                  │
│  ├── 向量化 (Embedding)                              │
│  └── 语义检索 (向量相似度)                            │
└─────────────────────────────────────────────────────┘
```

Agent 通过 SKILL.md 了解何时、如何调用 adbpg-mem CLI，CLI 负责与 ADBPG 记忆服务通信。Agent 不直接接触数据库或 REST API。

## 前置条件

| 依赖 | 要求 |
|------|------|
| CoPaw | 已安装并可运行 (`copaw app`) |
| Node.js | >= 18.0.0（用于 adbpg-mem Node 版本） |
| ADBPG Memory 服务 | REST 模式需要可达的 API 地址和密钥；SQL 模式需要 ADBPG 数据库连接信息 |

## 安装 adbpg-mem CLI

### Node.js 版本

```bash
cd adbpg-memory-cli/node
npm install
npm link    # 注册全局命令 adbpg-mem
```

### Python 版本

```bash
cd adbpg-memory-cli/python
pip install -e .
```

两个版本安装后都提供 `adbpg-mem` 命令，行为完全一致。选择已有的运行时即可。

### 验证安装

```bash
adbpg-mem --version
# 输出: 0.1.0
```

## 配置记忆服务

### 方式一：交互式向导

```bash
adbpg-mem init
```

按提示选择 REST 或 SQL 模式，填入连接信息。

### 方式二：命令行逐项配置

```bash
# REST 模式（推荐）
adbpg-mem config set api_mode rest
adbpg-mem config set rest_base_url "https://your-adbpg-memory-server.com"
adbpg-mem config set rest_api_key "your-api-key"
adbpg-mem config set user_id "your-name"
```

### 方式三：环境变量

```bash
export ADBPG_MEM_API_MODE=rest
export ADBPG_MEM_REST_BASE_URL="https://your-server.com"
export ADBPG_MEM_REST_API_KEY="your-api-key"
export ADBPG_MEM_USER_ID="your-name"
```

配置优先级：CLI 参数 > 环境变量 > 配置文件（`~/.adbpg-mem/config.json`）。

### 验证连接

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "test" --agent
```

返回 `"status": "ok"` 即表示连接成功。

## 部署 Skill 到 CoPaw

### 步骤 1：复制 SKILL.md

将 `adbpg-memory-cli/SKILL.md` 复制到 CoPaw Agent 的 skills 目录：

```bash
# 默认 Agent 的 skills 目录
SKILLS_DIR=~/.copaw/workspaces/default/skills

# 创建 skill 目录
mkdir -p "$SKILLS_DIR/adbpg_memory"
cp adbpg-memory-cli/SKILL.md "$SKILLS_DIR/adbpg_memory/SKILL.md"
```

如果使用自定义工作目录：

```bash
SKILLS_DIR=$COPAW_WORKING_DIR/workspaces/default/skills
mkdir -p "$SKILLS_DIR/adbpg_memory"
cp adbpg-memory-cli/SKILL.md "$SKILLS_DIR/adbpg_memory/SKILL.md"
```

### 步骤 2：启用 Skill

通过 CoPaw Console UI：Settings → Skills → 找到 `adbpg_memory` → 启用。

或通过 API：

```bash
curl -X POST http://127.0.0.1:8088/api/skills/adbpg_memory/enable
```

### 步骤 3：验证加载

```bash
curl -s http://127.0.0.1:8088/api/skills | python3 -c "
import json,sys
for s in json.load(sys.stdin):
    if 'adbpg' in s.get('name',''):
        print(f'{s[\"name\"]}: enabled={s[\"enabled\"]}')"
```

输出 `adbpg_memory: enabled=True` 即表示加载成功。

### SSL 注意事项

如果 ADBPG Memory 服务使用自签名证书，需要确保 CoPaw 进程启动时带有 SSL 环境变量：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 copaw app
```

SKILL.md 中的命令示例已包含 `NODE_TLS_REJECT_UNAUTHORIZED=0` 前缀，Agent 调用时会自动带上。正式证书环境下可去掉。

## 验证集成

### 测试存储

在 CoPaw Console 中对 Agent 说：

```
你：记住，我最喜欢的水果是西瓜
```

Agent 应该调用 `adbpg-mem add` 存储，并确认已记住。

### 测试检索

开启新对话（或重启 CoPaw），然后：

```
你：我最喜欢的水果是什么？
```

Agent 应该调用 `adbpg-mem search` 检索，并回答"西瓜"。

### 通过 CLI 验证

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "水果" --agent
```

确认记忆确实存储在 ADBPG 中。

## 工作原理

### SKILL.md 的角色

SKILL.md 被加载到 Agent 的 system prompt 中，告诉 Agent：

1. **何时存储** — 用户说"记住"、提到个人信息、做出决策时
2. **何时检索** — 回答关于过往、偏好、历史的问题前
3. **如何调用** — 通过 `execute_shell_command` 工具执行 `adbpg-mem` 命令
4. **如何解析** — `--agent` 模式返回结构化 JSON，检查 `status` 和 `data` 字段
5. **安全边界** — 不暴露命令细节、不存敏感信息、删除前确认

### 标准交互流程

```
用户消息 → Agent 判断是否需要记忆
                ↓ 是
        adbpg-mem search (检索相关记忆)
                ↓
        结合记忆生成回答
                ↓
        判断是否有新信息值得记住
                ↓ 是
        adbpg-mem add (存储新事实)
                ↓
        回复用户
```

### Agent 输出格式

Agent 使用 `--agent` 参数获取结构化 JSON：

```json
{
  "status": "ok",
  "command": "search",
  "duration_ms": 245,
  "scope": { "user_id": "alice", "agent_id": "", "run_id": "" },
  "count": 2,
  "data": [
    { "id": "...", "memory": "最喜欢的水果是西瓜", "score": 0.83 }
  ]
}
```

Agent 根据 `status` 判断成功/失败，根据 `score` 判断相关度（>0.7 高度相关）。

## 记忆隔离

adbpg-mem 通过三个平级的 metadata 字段实现隔离：

| 参数 | 用途 | CoPaw 场景 |
|------|------|-----------|
| `-u` user_id | 区分谁的记忆 | 个人助手用固定值（如你的名字） |
| `-a` agent_id | 区分哪个 Agent 的记忆 | 多 Agent 时各自独立 |
| `-r` run_id | 区分哪次对话的记忆 | 按项目/任务隔离 |

三个 ID 是 AND 条件，可任意组合，互不依赖。不传某个 ID 则该维度不过滤。

### 个人助手（默认，无隔离）

只用 config 中的 `user_id`，所有记忆共享：

```bash
adbpg-mem add "喜欢蓝色" --agent
adbpg-mem search "颜色" --agent
```

### 多 Agent 隔离

每个 Agent 从 system prompt 的 `Agent Identity` 获取自己的 `agent_id`：

```bash
adbpg-mem add "Q3 OKR" -a xK3mNp --agent    # 工作助手
adbpg-mem add "周末爬山" -a yM7pQr --agent    # 生活助手
```

### 会话隔离

用户主动命名或自动生成 run_id：

```bash
adbpg-mem add "用 Rust 重写" -r "项目-重构" --agent
```

### 配置管理

隔离状态由 CLI 自管，落到 **per-agent 私有配置** `~/.adbpg-mem/agents/<agent_id>.json`，通过 `adbpg-mem agent-config` 子命令读写（与系统级 `~/.adbpg-mem/config.json` 区分）：

```bash
# 查看本 agent 的隔离状态（不存在时返回默认值）
adbpg-mem agent-config show -a xK3mNp

# 开启 / 关闭 agent 隔离
adbpg-mem agent-config set isolation_agent true  -a xK3mNp
adbpg-mem agent-config set isolation_agent false -a xK3mNp

# 设置会话隔离模式：off / manual / auto / tag
adbpg-mem agent-config set isolation_run_mode manual -a xK3mNp

# 设置 / 清除当前活跃 run_id
adbpg-mem agent-config set   current_run_id "项目-重构讨论" -a xK3mNp
adbpg-mem agent-config unset current_run_id                 -a xK3mNp
```

用户可随时通过对话修改隔离配置，Agent 调用 `adbpg-mem agent-config set` 即时生效。这套机制跨平台通用（CoPaw、Claude Code、Wukong、钉钉助手、Cursor 等），不依赖任何平台的 profile 文件。

## 与本地文件记忆的协作

CoPaw 自带基于文件的记忆系统（`MEMORY.md` + `memory/*.md`）。两者互补：

| | adbpg-mem 长期记忆 | 本地文件记忆 |
|---|---|---|
| 存储位置 | ADBPG 云端数据库 | 本地工作区文件 |
| 持久性 | 跨设备、跨工作区 | 仅当前工作区 |
| 检索方式 | 语义向量搜索 | 全文搜索 / 直接读取 |
| 适合存储 | 事实性记忆（偏好、决策、经验） | 工作笔记、工具配置、每日日志 |
| 容量 | 无限制 | 受文件大小和 context window 限制 |

默认两者共存，重要事实同时存入两者是可以的。

### 切换为纯 adbpg-mem 模式

如果只想使用 adbpg-mem 长期记忆，不使用本地文件记忆，需要修改 Agent workspace 下的 `AGENTS.md`：

**1. 替换「记忆」章节为：**

```markdown
## 记忆

每次会话都是全新的。你的长期记忆通过 `adbpg-mem` 技能实现，详见 `skills/adbpg_memory/SKILL.md`。

- 需要记住信息时 → 使用 `adbpg-mem add` 存储
- 需要回忆信息时 → 使用 `adbpg-mem search` 检索
- 除非用户明确要求，否则不要在记忆中记录敏感信息
```

**2. 删除「工具」章节中引用 `MEMORY.md` 的部分：**

```markdown
## 工具

Skills 提供工具。需要用时查看它的 `SKILL.md`。身份和用户资料记在 `PROFILE.md` 里。
```

**3. 删除「Heartbeat」章节中的「记忆维护」子章节**（浏览 memory/*.md、更新 MEMORY.md 等内容）。

修改后开启新对话即可生效。

### 恢复本地文件记忆

将 `AGENTS.md` 的「记忆」章节恢复为 CoPaw 默认模板内容（源码位于 `src/copaw/agents/md_files/zh/AGENTS.md`），包括每日笔记、MEMORY.md、主动记录规则、memory_search 检索工具、Heartbeat 记忆维护等。

恢复后开启新对话即可生效。两种记忆方式将再次共存。

## 多 Agent 部署

CoPaw 的 skill 是 per-agent 的，每个 Agent 有独立的 workspace 和 skills 目录。不同 Agent 可以有不同的长记忆配置，甚至可以选择不部署长记忆 skill。

### 目录结构

```
~/.copaw/workspaces/
├── agent_A/
│   ├── skills/adbpg_memory/SKILL.md   ← Agent A 独立的 skill
│   └── PROFILE.md                      ← Agent A 的用户画像（连接/身份元信息）
├── agent_B/
│   ├── skills/adbpg_memory/SKILL.md   ← Agent B 独立的 skill
│   └── PROFILE.md                      ← Agent B 的用户画像
└── agent_C/
    └── skills/                         ← Agent C 不需要长记忆，不部署
```

### 为指定 Agent 部署

```bash
# 为 agent_A 部署
AGENT_SKILLS=~/.copaw/workspaces/agent_A/skills
mkdir -p "$AGENT_SKILLS/adbpg_memory"
cp adbpg-memory-cli/SKILL.md "$AGENT_SKILLS/adbpg_memory/SKILL.md"

# 通过 API 启用（指定 agent）
curl -X POST http://127.0.0.1:8088/api/skills/adbpg_memory/enable \
  -H "X-Agent-Id: agent_A"
```

### 不同 Agent 连不同服务

`~/.adbpg-mem/config.json` 是全局共享的默认配置，但 Agent 可以通过环境变量覆盖连接信息。在 PROFILE.md 中记录该 Agent 专属的连接参数，Agent 调用时通过环境变量前缀覆盖：

```bash
# Agent A 连生产环境
ADBPG_MEM_REST_BASE_URL=https://prod.example.com \
ADBPG_MEM_REST_API_KEY=prod-key \
  adbpg-mem add "事实" --agent

# Agent B 连测试环境
ADBPG_MEM_REST_BASE_URL=https://test.example.com \
ADBPG_MEM_REST_API_KEY=test-key \
  adbpg-mem add "事实" --agent
```

CLI 配置优先级：CLI 参数 > 环境变量 > 配置文件。

### 隔离策略差异

每个 Agent 在各自的 **per-agent 私有配置** `~/.adbpg-mem/agents/<agent_id>.json` 中独立维护隔离策略，通过 `adbpg-mem agent-config set` 写入（详见上文「配置管理」）：

- Agent A：开启 agent 隔离 + 会话隔离，连生产环境
- Agent B：只用 user_id 不隔离，连测试环境
- Agent C：不部署长记忆 skill

这些配置互不影响，由各 Agent 根据自己的 SKILL.md 和 `~/.adbpg-mem/agents/<agent_id>.json` 独立执行。

## 扩展到其他 Agent 平台

SKILL.md 的设计是平台无关的。只要 Agent 平台满足以下条件，就可以直接使用：

1. **能加载 SKILL.md 到 system prompt** — CoPaw 通过 skills 目录加载，OpenClaw 通过 plugin skills 加载
2. **Agent 有 shell 执行能力** — 能调用 `adbpg-mem` 命令
3. **adbpg-mem CLI 已安装并配置** — 在 Agent 运行环境的 PATH 中

### OpenClaw 适配

```bash
mkdir -p ~/.openclaw/skills/adbpg-memory
cp adbpg-memory-cli/SKILL.md ~/.openclaw/skills/adbpg-memory/SKILL.md
```

### 其他平台

对于不支持 SKILL.md 的平台，可以将 SKILL.md 的内容直接追加到 Agent 的 system prompt 中。

## 常见问题

### Agent 说"记住了"但没有调用 adbpg-mem

- 检查 SKILL.md 是否已启用（`enabled=True`）
- 检查 Agent 是否有 `execute_shell_command` 工具
- Agent 可能用了本地文件记忆而非 adbpg-mem，可以在对话中明确要求"用 adbpg-mem 存储"

### adbpg-mem 命令执行失败

- SSL 错误：命令前加 `NODE_TLS_REJECT_UNAUTHORIZED=0`
- 命令不存在：确认 `adbpg-mem` 在 PATH 中（`which adbpg-mem`）
- 连接失败：检查 `~/.adbpg-mem/config.json` 中的 REST URL 和 API Key

### add 后 search 找不到

- 记忆处理有短暂延迟（2-3 秒），稍后重试
- 确认 `user_id` 是否匹配（大小写敏感）
- 服务端可能将中文提取为英文事实，用英文关键词搜索试试

### 多 Agent 场景下记忆串了

- 确认每个 Agent 是否在命令中带了 `-a <agent_id>`
- 检查 `adbpg-mem agent-config show -a <agent_id>` 中的 `isolation_agent` 是否为 `true`

### 如何查看所有已存储的记忆

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem list --agent
```

### 如何清理测试数据

delete 功能尚在开发中，目前需要通过 REST API 或数据库直接操作。
