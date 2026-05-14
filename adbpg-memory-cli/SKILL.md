---
name: adbpg-memory
description: >
  ADBPG 长期记忆技能。每次新会话你没有任何上下文，必须通过 adbpg-mem 检索长期记忆。

  【检索记忆 - 必须先做】收到涉及用户身份、偏好、过往对话、个人信息的消息时，
  必须先执行 NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" --agent 再回答。
  不要凭猜测说"我不知道"，必须先搜索。

  【存储记忆】用户说"记住"、提到个人信息、做出决策时，
  执行 NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "提炼的事实" --agent 存储。
  提炼事实再存储，不存原文，保留用户原始语言，不存敏感信息。

  【输出格式】--agent 返回 JSON，检查 status 字段（ok/error），搜索结果在 data 数组中，score > 0.7 高度相关。

  【展示检索结果】检索到记忆后，在回复开头简要列出相关记忆（如"根据记忆：你叫子华，喜欢 Python"），
  让用户能看到检索到了什么。如果检索到记忆但与问题无关，也简要提及"检索到 N 条记忆但与当前问题无关"。

  不要在回复中暴露 adbpg-mem 命令细节和原始 JSON。更多用法参见 SKILL.md。
license: Apache-2.0
metadata:
  author: ADBPG
  version: "0.1.0"
  category: ai-memory
  tags: "memory, personalization, adbpg, cli, long-term-memory"
compatibility: >
  Node.js 18+ (npm install) 或 Python 3.10+ (pip install)。
  需要 adbpg-mem CLI 已安装并通过 adbpg-mem init 完成配置。
  支持 SQL 模式（直连 ADBPG）和 REST 模式（HTTP API）。
---

# ADBPG 长期记忆

adbpg-mem 是基于 AnalyticDB for PostgreSQL 的长期记忆 CLI 工具。它将对话中的事实提取并存储为向量化记忆，支持语义检索，让 Agent 拥有跨会话的持久记忆能力。

本 SKILL.md 是路由和行为引导文档，定义记忆的存储时机、检索时机和安全边界。

## 何时存储记忆

对话中出现以下情况时，**主动**调用 `adbpg-mem add` 存储记忆：

- 用户明确说"记住这个"、"记下来"、"保存一下"或等价表达
- 用户提到个人信息（名字、生日、偏好、习惯、工作方式）
- 对话中做出重要决策或结论
- 用户表达喜好或不满
- 发现的工具配置、项目上下文、技术细节
- 任何你判断未来会话可能用到的信息

**关键原则：不要总是等用户说"记住"。如果信息对未来有价值，主动存储。**

## 何时检索记忆

**每次新会话的第一条消息，以及以下类型问题，必须先调用 `adbpg-mem search` 检索长期记忆再回答：**

- 关于用户身份的问题（"我叫什么"、"我是谁"）
- 关于过往对话、决策、约定的问题
- 涉及用户偏好、习惯、个人信息的问题
- "之前说过什么"、"上次提到的"、"我的 XX 是什么"
- 需要历史上下文才能准确回答的问题
- 任何你不确定答案、但用户可能之前告诉过你的问题

**重要：不要凭当前会话的上下文就认为自己不知道。每次新会话你的记忆是空的，必须通过 adbpg-mem search 检索才能知道用户之前说过什么。**

检索到记忆后，将其作为上下文辅助回答，但不要原样复述检索结果。

## CLI 命令参考

所有命令通过 `adbpg-mem` 执行，使用 `--agent` 获取结构化 JSON 输出。

> **SSL 注意：** 如果服务端使用自签名证书，需要在每条命令前加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 前缀。正式证书环境下不需要。

### 存储记忆

```bash
# 从对话文本存储
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "用户喜欢蓝色" --agent

# 从 JSON messages 存储（保留角色信息，推荐）
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add --json-messages '[{"role":"user","content":"我喜欢蓝色"},{"role":"assistant","content":"好的"}]' --agent

# 指定用户范围
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "偏好深色模式" -u alice --agent

# 附加元数据
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "生日是1月1日" --metadata '{"categories":["personal"]}' --agent
```

### 检索记忆

```bash
# 语义搜索
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "喜欢什么颜色" --agent

# 限制结果数
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "饮食偏好" --limit 3 --agent

# 指定用户范围
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "工作习惯" -u alice --agent
```

### 列出所有记忆

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem list --agent
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem list -u alice --agent
```

### 删除记忆

```bash
# 删除指定用户的所有记忆（需确认）
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem delete --all -u alice --force --agent
```

### 连接状态

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem status --agent
```

### agent-config 子命令（per-agent 隔离状态）

`agent-config` 用于读写 **本 Agent 私有的隔离状态**，独立于系统级 `~/.adbpg-mem/config.json`，落盘到 `~/.adbpg-mem/agents/<agent_id>.json`（权限 0600，首次写入自动创建目录）。所有子命令的 `-a <agent_id>` 必填，`agent_id` 取自 system prompt 的 Agent Identity 段落。

支持的字段：

| 字段 | 类型 | 默认值 | 含义 |
|------|------|--------|------|
| `isolation_agent` | boolean | `false` | 是否按 agent 隔离记忆（true → CLI 在 add/search 时注入 `-a`） |
| `isolation_run_mode` | enum | `off` | 会话隔离模式：`off` / `manual` / `auto` / `tag` |
| `current_run_id` | string | 未设置 | 当前活跃的 run_id（仅在 manual/auto 模式下使用） |

四个动作：

```bash
# set —— 设置某个字段
adbpg-mem agent-config set isolation_agent true -a xK3mNp
adbpg-mem agent-config set isolation_run_mode manual -a xK3mNp
adbpg-mem agent-config set current_run_id "项目-重构讨论" -a xK3mNp

# get —— 读取单个字段
adbpg-mem agent-config get isolation_agent -a xK3mNp

# show —— 输出该 agent 的全部状态（不存在时返回默认值，status=ok）
adbpg-mem agent-config show -a xK3mNp

# unset —— 删除某个字段（幂等：字段不存在也返回 status=ok）
adbpg-mem agent-config unset current_run_id -a xK3mNp
```

`--agent` 输出格式与其他命令一致（status/data envelope）。

## Agent 输出格式

使用 `--agent` 时，stdout 输出标准 JSON envelope，spinner 和警告输出到 stderr：

```json
{
  "status": "ok",
  "command": "search",
  "duration_ms": 245,
  "scope": { "user_id": "alice", "agent_id": "", "run_id": "" },
  "count": 2,
  "data": [
    {
      "id": "cc0de662-...",
      "memory": "最喜欢的颜色是蓝色",
      "score": 0.83,
      "created_at": "2026-04-16T17:08:08+08:00"
    }
  ]
}
```

错误时：

```json
{
  "status": "error",
  "command": "search",
  "error": "Connection timed out",
  "data": null
}
```

**解析规则：** 始终检查 `status` 字段。`"ok"` 表示成功，`"error"` 表示失败。搜索结果在 `data` 数组中，按 `score` 降序排列。

## 标准交互模式

每次涉及记忆的对话遵循 **检索 → 回答 → 存储** 模式：

```
1. 用户发来消息
2. 判断是否需要历史上下文 → 是 → adbpg-mem search "相关查询" --agent
3. 结合检索到的记忆生成回答
4. 判断对话中是否产生了值得记住的新信息 → 是 → adbpg-mem add "提炼的事实" --agent
5. 回复用户
```

## 存储规则

- **提炼事实，不存原文：** 存储 `"用户的生日是1月1日"`，而非整段对话
- **保留用户原始语言：** 用户用中文说的，存中文；用英文说的，存英文
- **一次一个事实：** 每条记忆存储一个独立事实，便于精确检索
- **避免重复：** 存储前先 search 确认是否已有相同记忆，已有则跳过
- **不存敏感信息：** 除非用户明确要求，否则不存储密码、密钥、token 等
- **写入后确认：** 检查 `--agent` 输出的 `status` 是否为 `"ok"`，失败时告知用户

## 检索规则

- **用自然语言查询：** search 基于语义匹配，用自然语言描述比关键词更有效
- **关注 score：** score > 0.7 高度相关，0.4-0.7 可能相关，< 0.4 可忽略
- **无结果时诚实：** 如果没有检索到相关记忆，直接告诉用户"我没有关于这个的记忆"
- **不编造记忆：** 只使用实际检索到的内容，绝不凭推测声称"记得"

## 安全边界

- 绝不在回复中暴露 `adbpg-mem` 命令细节、API key、数据库连接信息
- 绝不存储用户未在对话中提及的信息
- 绝不主动建议删除记忆，记忆的价值在于持久化
- 删除操作仅在用户明确要求时执行，且必须获得确认
- 记忆内容仅用于辅助当前用户的对话，不跨用户共享

## 首次配置（Skill Bootstrap）

本 skill 首次加载时，执行以下流程。不要在 Agent 的全局 Bootstrap 阶段处理，仅在用户首次触发记忆相关操作或主动要求"配置长期记忆"时执行。

### 步骤 1：检测连接

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem status --agent
```

- `status` 为 `"ok"` → 跳到步骤 3
- `status` 为 `"error"` 或命令不存在 → 进入步骤 2

### 步骤 2：引导初始化

告知用户需要配置长期记忆服务，提供两个选项：

> 长期记忆服务未配置。请选择连接方式：
> 1. REST 模式（推荐）— 填入 API 地址和密钥
> 2. SQL 模式 — 直连 ADBPG 数据库

用户选择后，通过 `adbpg-mem config set` 逐项写入配置：

```bash
# REST 模式
adbpg-mem config set api_mode rest
adbpg-mem config set rest_base_url "https://your-server.com"
adbpg-mem config set rest_api_key "your-api-key"

# 或 SQL 模式
adbpg-mem config set api_mode sql
adbpg-mem config set host "gp-xxx.gpdb.rds.aliyuncs.com"
adbpg-mem config set port 5432
# ... 其他字段
```

也可以引导用户直接运行 `adbpg-mem init` 交互式向导。

配置保存在 `~/.adbpg-mem/config.json`。

### 步骤 3：设置记忆用户标识

询问用户希望用什么名字作为记忆标识：

> 连接成功！你希望用什么名字作为你的记忆标识？
> （用于区分你的记忆，比如你的名字或昵称。直接回车使用默认值 "default"）

用户回答后：

```bash
adbpg-mem config set user_id <用户选择的名字>
```

### 步骤 4：持久化 Agent 私有配置

将本 Agent 的隔离状态写入 **per-agent 私有配置文件** `~/.adbpg-mem/agents/<agent_id>.json`，通过 `adbpg-mem agent-config set` 命令操作（不要直接编辑文件，也不要写入任何平台 profile 文件）：

```bash
# agent_id 必填，从 system prompt 的 Agent Identity 段落获取
adbpg-mem agent-config set isolation_agent false -a <agent_id>
adbpg-mem agent-config set isolation_run_mode off -a <agent_id>
```

**与系统级 config 的区分：**

| 文件 | 路径 | 内容 | 操作命令 |
|------|------|------|---------|
| 系统级配置 | `~/.adbpg-mem/config.json` | 连接信息（api_mode、host、rest_base_url、user_id 等），全机共享 | `adbpg-mem config set/get` |
| Agent 私有配置 | `~/.adbpg-mem/agents/<agent_id>.json` | 本 Agent 的隔离状态（isolation_agent、isolation_run_mode、current_run_id），per-agent 隔离，权限 0600 | `adbpg-mem agent-config set/get/show/unset` |

**这是平台无关的设计。** 配置存储由 CLI 自己管理，跟任何特定平台的 profile 文件都解耦。同一份 SKILL.md 在 CoPaw、Claude Code、Wukong、钉钉助手、Cursor 等平台上都能用，状态都落到 `~/.adbpg-mem/agents/<agent_id>.json`。

之后任意时刻 Agent 都可以通过 `adbpg-mem agent-config show -a <agent_id>` 读回当前隔离状态来决定是否在 add/search 命令中带 `-a` / `-r`。

### 步骤 5：确认完成

用一条 search 验证链路：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "测试" --agent
```

无论是否有结果，只要 `status` 为 `"ok"` 即表示配置成功。告知用户：

> ✅ 长期记忆已配置完成。今后对话中我会自动记住重要信息，也能回忆之前的内容。

## 记忆范围与隔离

adbpg-mem 通过三个 scope 参数实现记忆隔离：`-u`（user_id）、`-a`（agent_id）、`-r`（run_id）。

**核心原理：** 三个 ID 是平级的 metadata 字段，不是嵌套层级。存储时作为标签写入记忆，检索时作为 AND 条件过滤。传了哪个就按哪个过滤，不传的字段不参与过滤。至少需要传一个。

```
存储: metadata = { user_id: "alice", agent_id: "work", run_id: "s1" }
检索: WHERE user_id="alice" AND agent_id="work" AND run_id="s1"
```

三个 ID 可以任意组合，互不依赖：
- 只传 `-u alice` → 按 user 过滤
- 只传 `-a work` → 按 agent 过滤
- 只传 `-r s1` → 按 session 过滤
- 传 `-u alice -a work` → 按 user AND agent 过滤
- 三个都传 → 最精确的过滤
- 不传某个 → 该维度不过滤（搜索范围更广）

### 默认行为（个人助手推荐）

只使用 config 中的 `user_id`，不传 `-a` 和 `-r`。所有记忆共享，跨会话可用。

```bash
adbpg-mem add "喜欢蓝色" --agent
adbpg-mem search "颜色" --agent
```

大多数个人助手场景用这个就够了。

### Agent 隔离（多 Agent 场景）

当系统中有多个 Agent（如工作助手、生活助手），各自记忆需要独立时，在命令中加 `-a <agent_id>`。

**如何获取你的 agent_id：** 你的 system prompt 开头有 `Agent Identity` 段落，其中 `` `agent_id` `` 就是你的唯一标识（可能是 `default`、`xK3mNp` 等值）。直接使用该值，不要猜测或编造。

示例（假设你的 agent_id 是 `xK3mNp`）：

```bash
# 存储时带上自己的 agent_id
adbpg-mem add "Q3 OKR 已确认" -a xK3mNp --agent

# 搜索时也带上，只搜自己的记忆
adbpg-mem search "OKR" -a xK3mNp --agent
```

**开启/关闭 Agent 隔离不需要修改连接配置（`~/.adbpg-mem/config.json`）。** 隔离通过 CLI 的 `-a` 参数实现：
- 带 `-a` → 记忆按 agent 隔离
- 不带 `-a` → 所有 Agent 共享记忆

用户要求开启或关闭时，调用 `adbpg-mem agent-config set` 把状态持久化到 **per-agent 私有配置** `~/.adbpg-mem/agents/<agent_id>.json`。`-a` 必填，`agent_id` 来自 system prompt 的 Agent Identity 段落，不要猜测：

```bash
# 开启
adbpg-mem agent-config set isolation_agent true -a xK3mNp

# 关闭
adbpg-mem agent-config set isolation_agent false -a xK3mNp

# 查看当前状态
adbpg-mem agent-config show -a xK3mNp
```

之后每次 add/search 前 Agent 读取该状态决定是否带 `-a`。这套机制跨平台通用（CoPaw、Claude Code、Wukong、钉钉助手、Cursor 等），不依赖任何平台的 profile 文件。

### 会话隔离（按需开启）

会话隔离让不同对话的记忆互不干扰，适用于：
- 独立项目讨论，不希望记忆互相污染
- 角色扮演场景，每次对话是独立的故事线
- 多轮任务，每个任务有自己的上下文

**实现方式：** Agent 无法直接获取系统内部的 session_id，因此通过 `-r`（run_id）参数由 Agent 自行管理。

**方案 A：用户主动命名（推荐）**

用户开启会话隔离后，每次新对话开始时询问本次会话的主题名：

```
Agent: "这是一个新的对话。请给本次对话起个名字（用于记忆隔离），或直接回车跳过。"
用户: "项目-重构讨论"
```

之后本次对话中所有记忆操作带上该 run_id：

```bash
adbpg-mem add "决定用 Rust 重写" -r "项目-重构讨论" --agent
adbpg-mem search "技术选型" -r "项目-重构讨论" --agent
```

**方案 B：自动生成**

如果用户不想每次命名，Agent 自动用日期时间生成：

```bash
# 自动生成 run_id，格式：YYYY-MM-DD-HHMMSS
adbpg-mem add "讨论结论" -r "2026-04-17-115700" --agent
```

**方案 C：不隔离但打标签**

不用 `-r` 隔离，而是通过 `--metadata` 标记会话来源，搜索时仍能看到所有记忆：

```bash
adbpg-mem add "讨论结论" --metadata '{"session":"项目-重构讨论"}' --agent
```

**开启会话隔离时：**

1. 用户说"开启会话隔离"
2. 询问用户偏好哪种方案（主动命名 / 自动生成 / 打标签）
3. 调用 `adbpg-mem agent-config set isolation_run_mode <mode> -a <agent_id>` 把模式持久化到 per-agent 配置（`<mode>` 取值：`manual` / `auto` / `tag`；关闭用 `off`）：

```bash
# 主动命名
adbpg-mem agent-config set isolation_run_mode manual -a xK3mNp

# 自动生成
adbpg-mem agent-config set isolation_run_mode auto -a xK3mNp

# 不隔离只打标签
adbpg-mem agent-config set isolation_run_mode tag -a xK3mNp
```

4. 每次新对话开始时，先 `adbpg-mem agent-config show -a <agent_id>` 读取 `isolation_run_mode`，根据模式获取或生成 run_id；获取后写回 `current_run_id`：

```bash
adbpg-mem agent-config set current_run_id "项目-重构讨论" -a xK3mNp
```

5. 对话结束或用户切换话题时，清空 `current_run_id`：

```bash
adbpg-mem agent-config unset current_run_id -a xK3mNp
```

`-a` 必填，`agent_id` 来自 system prompt。这套机制跨平台通用，不依赖任何平台的 profile 文件。

**跨会话搜索：** 即使开启了会话隔离，用户仍可以不带 `-r` 搜索所有记忆：

```bash
# 只搜当前会话
adbpg-mem search "技术选型" -r "项目-重构讨论" --agent

# 搜索所有会话的记忆（不带 -r）
adbpg-mem search "技术选型" --agent
```

### 修改隔离配置

用户随时可以说"修改记忆配置"或"开启 Agent 隔离"，此时：

1. 根据用户需求调整 `-u` / `-a` / `-r` 的使用方式
2. 如果修改了 user_id（系统级、跨 Agent 共享）：`adbpg-mem config set user_id <新值>`
3. 调整本 Agent 的隔离状态时，统一用 `adbpg-mem agent-config set` 系列命令写入 `~/.adbpg-mem/agents/<agent_id>.json`：
   - `adbpg-mem agent-config set isolation_agent <true|false> -a <agent_id>`
   - `adbpg-mem agent-config set isolation_run_mode <off|manual|auto|tag> -a <agent_id>`
   - `adbpg-mem agent-config set current_run_id <值> -a <agent_id>` / `adbpg-mem agent-config unset current_run_id -a <agent_id>`

**不要写入任何平台 profile 文件**，所有 Agent 私有的隔离状态一律落到 CLI 自管的 `~/.adbpg-mem/agents/<agent_id>.json`。这样跨平台（CoPaw、Claude Code、Wukong、钉钉助手、Cursor 等）行为完全一致。

### 隔离层级总结

三个 ID 是平级的 AND 过滤条件，可任意组合：

| 参数 | 用途 | 何时使用 |
|------|------|---------|
| `-u` user_id | 区分"谁的记忆" | 始终使用（config 默认值） |
| `-a` agent_id | 区分"哪个 Agent 的记忆" | 多 Agent 且需要隔离时 |
| `-r` run_id | 区分"哪次对话的记忆" | 项目讨论、角色扮演等需要对话隔离的场景 |

示例组合：

```bash
# 只按 user 过滤
adbpg-mem search "偏好" -u alice --agent

# 只按 agent 过滤（不限用户）
adbpg-mem search "OKR" -a work --agent

# user + agent 组合
adbpg-mem search "OKR" -u alice -a work --agent

# 三个都传，最精确
adbpg-mem search "决策" -u alice -a work -r "session-001" --agent

# 去掉某个维度，搜索范围变广
adbpg-mem search "决策" -u alice --agent  # alice 所有 agent、所有 session 的记忆
```

## 自定义事实提取（SQL 模式）

SQL 模式下可通过 `--prompt` 控制从对话中提取什么样的事实：

```bash
# 默认：提取所有事实
adbpg-mem add --json-messages '[{"role":"user","content":"我在杭州工作，喜欢火锅，最近在学Rust"}]' --agent

# 只提取技术相关事实
adbpg-mem add --json-messages '[...]' \
  --prompt '从对话中仅提取技术相关的事实，忽略生活类信息。输出格式：{"facts":["fact1","fact2"]}' \
  --agent
```

适用场景：
- 技术助手只记技术知识，过滤闲聊
- 健康助手只记健康数据，过滤无关信息
- 学习助手只记知识点，过滤日常对话

注意：`--prompt` 仅在 SQL 模式下生效，REST 模式会忽略此参数。

## 与本地文件记忆的协作

如果 Agent 同时使用本地文件记忆（如 CoPaw 的 `MEMORY.md` 和 `memory/*.md`）：

- **adbpg-mem** 用于：跨会话的事实性记忆（偏好、个人信息、决策、经验教训）
- **本地文件** 用于：当前工作区的上下文笔记、工具配置、每日日志
- 两者互补，不冲突。重要事实同时存入 adbpg-mem 和本地文件是可以的

### 切换为纯 adbpg-mem 模式

当用户要求"去掉本地文件记忆"或"只用长期记忆"时，修改 AGENTS.md：

1. 将「记忆」章节替换为：

```markdown
## 记忆

每次会话都是全新的。你的长期记忆通过 `adbpg-mem` 技能实现，详见 `skills/adbpg_memory/SKILL.md`。

- 需要记住信息时 → 使用 `adbpg-mem add` 存储
- 需要回忆信息时 → 使用 `adbpg-mem search` 检索
- 除非用户明确要求，否则不要在记忆中记录敏感信息
```

2. 删除「工具」章节中引用 `MEMORY.md` 的部分
3. 删除「Heartbeat」章节中的「记忆维护」子章节（浏览 memory/*.md、更新 MEMORY.md 等）

### 恢复本地文件记忆

当用户要求"恢复本地记忆"或"同时使用两种记忆"时，将 AGENTS.md 的「记忆」章节恢复为 CoPaw 默认模板内容（位于 `src/copaw/agents/md_files/zh/AGENTS.md`），包括：

- 每日笔记 `memory/YYYY-MM-DD.md`
- 长期记忆 `MEMORY.md`
- 主动记录规则
- `memory_search` 检索工具
- Heartbeat 期间的记忆维护

## Node.js 与 Python 对等性

adbpg-mem 提供 Node.js 和 Python 两套实现，命令名、参数、输出格式、错误信息完全一致。选择已安装的运行时即可。

## 常见问题

- **add 后立即 search 找不到：** 记忆处理可能有短暂延迟，等待 2-3 秒后重试
- **search 返回空：** 确认 `user_id` 是否匹配（大小写敏感），确认记忆确实已存储
- **status 返回 404：** 部分部署无 health 端点，不影响 add/search/list 正常使用
- **SSL 证书错误：** 自签名证书环境下，在每条命令前加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 前缀。正式证书环境下不需要。
