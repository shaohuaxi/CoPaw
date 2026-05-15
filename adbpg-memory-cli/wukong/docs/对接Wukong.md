# 基于长记忆 Skill 对接 Wukong

# 概述

通过 SKILL.md + 自带的零依赖 Node 脚本 `scripts/adbpg-mem.mjs`，让 Wukong（钉钉 AI 助手）平台上的 Agent 拥有 ADBPG 长期记忆能力。

支持记忆添加、检索、列表、删除等基础能力，支持 user / agent / session 三维隔离，PENDING 异步状态处理。

适用场景：
- 跨会话保留用户偏好、个人信息、历史决策
- 多 Agent 共存时按 agent 隔离记忆
- 项目讨论 / 角色扮演场景按 session 隔离
- 个性化推荐 / 历史回忆 / 偏好查询

# 使用方式

## 1、安装 Skill

Wukong 沙箱无法 npm install，**所有依赖代码必须随 skill ZIP 一起部署**。Skill 包结构：

```
adbpg-memory/
├── SKILL.md                          # 技能定义 + 命令样板 + bootstrap 流程
├── scripts/adbpg-mem.mjs             # 零依赖 Node 脚本（沙箱执行入口）
└── shared/
    ├── agent-config-schema.json      # per-agent 隔离配置 schema
    ├── config-schema.json            # 全局连接配置 schema
    └── config.example.rest.json      # bootstrap 示例
```

最小 ZIP 约 21 KB（解压 67 KB，5 个文件），无 node_modules、无测试代码。

### 方式 A：用 skill-craft package_skill.py 一键安装（推荐）

```bash
# 卸载同名旧版（避免历史 stub 冲突）
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/package_skill.py \
  --skill-dir /path/to/adbpg-memory-skill-pkg \
  --agent wukong --uninstall

# 安装新版
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/package_skill.py \
  --skill-dir /path/to/adbpg-memory-skill-pkg \
  --agent wukong

# 输出示例：
# [ok] wukong: installed: adbpg-memory (id=a3361e65-95e7-44ed-a8f9-41a151794b78)
```

`package_skill.py` 会自动：
- 找同名 skill 删掉（dedupe）
- 把 `--skill-dir` 打成 ZIP（自动排除 `node_modules` / `__pycache__` 等）
- 通过 wukong-cli 上传安装

### 方式 B：在 Wukong 客户端 UI 手工上传 ZIP

1. 本地打包：

```bash
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/package_skill.py \
  --skill-dir /path/to/adbpg-memory-skill-pkg \
  --zip-output-dir /tmp
# 产出 /tmp/adbpg-memory.zip
```

2. 打开 Wukong 客户端 → 技能广场 → 创建技能 → 上传 ZIP → 启用。

### 方式 C：从源码 staging（开发模式）

```bash
git clone https://github.com/shaohuaxi/CoPaw.git -b dev_adbpg_skills
cd CoPaw/adbpg-memory-cli

# 提取最小可发布子集到 staging（沙箱只需要这 5 个文件）
mkdir -p ../adbpg-memory-skill-pkg/{scripts,shared}
cp SKILL.md ../adbpg-memory-skill-pkg/
cp scripts/adbpg-mem.mjs ../adbpg-memory-skill-pkg/scripts/
cp shared/{agent-config-schema.json,config-schema.json,config.example.rest.json} \
   ../adbpg-memory-skill-pkg/shared/

# 然后用方式 A 安装
```

### SKILL.md 完整内容

直接看仓库最新版：[adbpg-memory-cli/SKILL.md](https://github.com/shaohuaxi/CoPaw/blob/dev_adbpg_skills/adbpg-memory-cli/SKILL.md)

关键 frontmatter 摘录（决定触发场景与运行时要求）：

```yaml
---
name: adbpg-memory
description: >
  ADBPG 长期记忆技能。每次新会话你没有任何上下文，必须通过 adbpg-mem 检索长期记忆。

  【检索记忆 - 必须先做】下列任何一种模式出现，必须先执行 adbpg-mem search 再回答：
  (a) 含"我/我的/我之前/我上次/我提过/还记得/来着/记不清/那本/那个"等回忆词；
  (b) 询问个人偏好/身份/经历/历史决策；
  (c) 需要个性化（推荐、建议）的请求。
  ...
license: Apache-2.0
metadata:
  author: ADBPG
  version: "0.1.0"
  category: ai-memory
  tags: "memory, personalization, adbpg, cli, long-term-memory"
  dependencies:
    apis:
      - "ADBPG Memory REST API (rest_base_url, configured via adbpg-mem init)"
compatibility: >
  必须 Node.js 18+（脚本启动时会校验，低于 18 立刻报错退出，因为依赖内置 fetch）。
  沙箱直接使用 skill 自带的 scripts/adbpg-mem.mjs，无需 npm install。
---
```

## 2、首次配置

Wukong 沙箱有自己的隔离 home，不会读取你本机的配置文件。所以首次使用时，需要在沙箱里 bootstrap 一次，把 ADBPG REST 服务的连接信息写入 workspace 持久路径。

跟 Wukong agent 说：

> 帮我配置长期记忆

Agent 期望行为：

1. 跑 `node ./scripts/adbpg-mem.mjs status --agent`
2. 看到 envelope `status=error`，error 信息含 "missing REST configuration" 三条修复建议
3. 询问你 `rest_base_url` 和 `rest_api_key`，**不**自己编值

提供配置：

> rest_base_url 是 `https://your-server.com`，api_key 是 `sk-xxxxx`

Agent 跑：

```bash
node ./scripts/adbpg-mem.mjs config init "https://your-server.com" "sk-xxxxx"
```

这条命令会：
- 写入 `<workspace cwd>/.adbpg-mem/config.json`（workspace 跨 session 持久）
- 文件权限 0600（仅自己可读写）
- 后续所有 `add` / `search` / `list` 等命令自动用这个 config

**只需 bootstrap 一次**，之后所有 session 都不需要再配。

## 3、使用 Skill

安装并配置后，Agent 自动记住对话中的重要信息，像和人说话一样自然交互即可。

### 自动触发存储

当你提到个人偏好、做出决策、分享重要信息时，Agent 会自动调 `adbpg-mem add` 提炼并存储。不需要学命令。

### 主动触发

- "记住，我的生日是 5 月 20 日"
- "我之前说过什么？"
- "回忆一下我的技术栈偏好"

### 管理记忆

- "查看我所有的记忆" → 触发 `adbpg-mem list`
- "删除我所有记忆" → 触发 `adbpg-mem delete --all`（会先要求你确认）

### 异步写入（PENDING 状态）

ADBPG REST 服务可能异步写入。Agent 会区分两种返回：

- `status=ok` → 直接告知"已记住"
- `status=pending` → 告知"已提交，稍后可通过 search 验证"，可选 sleep 2-3 秒后自动 search 一次确认

### 记忆隔离

默认情况下，所有记忆共享，跨会话可用。需要隔离时跟 Agent 说：

**按 Agent 隔离：** 多个 Agent 各记各的，互不干扰。

- "开启 Agent 记忆隔离 —— 让你（当前这个 agent）的记忆别跟其他 agent 混在一起"
- "关闭 Agent 隔离"

Agent 收到请求后会找自己的 `agent_id` 并写入 `<workspace>/.adbpg-mem/agents/<agent_id>.json`，后续 add / search 自动按此隔离。

**按会话隔离：** 不同项目或话题的记忆分开存放。

- "开启会话隔离" → Agent 会先呈现 3 个方案让你选：
  - **主动命名**：每次新对话起一个名字（如"项目-重构"）
  - **自动生成**：用日期时间自动生成 run_id
  - **打标签**：不真的隔离，只用 `--metadata` 标记
- "搜索所有会话的记忆"（不带 `-r` 跨会话搜索仍然可用）

**切换记忆用户：**

- "把记忆用户改成 alice" → 触发 `adbpg-mem config set user_id alice`

**查看当前隔离配置：**

- "我的记忆配置是什么？" → 触发 `adbpg-mem agent-config show -a <agent_id>`

# 沙箱执行机制

理解这一节有助于排查问题。

## 一、零依赖自包含运行时

`scripts/adbpg-mem.mjs` 是单文件 ESM 脚本，1158 行，**只 import Node 内置模块**（`node:fs/path/os/process`）。无第三方依赖。沙箱有 Node 18+ 即可运行，不需要 npm install。

启动时主动校验 Node 版本：

```javascript
const MIN_NODE_MAJOR = 18; // 内置 fetch + AbortController
```

如果沙箱 Node < 18，立刻输出结构化错误并退出：

```json
{
  "status": "error",
  "command": "startup",
  "error": "adbpg-mem.mjs requires Node 18+ (got v16.20.0). Built-in fetch is needed for REST mode.",
  "data": null
}
```

## 二、三级 Config Fallback

脚本按优先级查找配置：

| 顺序 | 来源 | 用途 |
|---|---|---|
| 1 | env vars `ADBPG_REST_BASE_URL` + `ADBPG_REST_API_KEY` | 高级用户手动 export，或 CI |
| 2 | `<cwd>/.adbpg-mem/config.json` | **沙箱主路径**（workspace 持久） |
| 3 | `~/.adbpg-mem/config.json` | 也支持，但沙箱 ~ 隔离时用不到 |

任一级命中即用。三级都没有 → 友好错误，给三条可执行修复建议。

## 三、PENDING 状态透传

ADBPG REST 异步返回：

```json
{ "results": [ { "status": "PENDING", "event_id": "..." } ] }
```

脚本检测嵌套 PENDING（顶层或 `results[*].status`），envelope 输出 `status=pending`：

```json
{
  "status": "pending",
  "command": "add",
  "duration_ms": 401,
  "scope": {...},
  "data": { "results": [...] }
}
```

SKILL.md 教 Agent：pending 不直接说"已记住"，而是"已提交，稍后验证"。

## 四、命令调用约定（不依赖 PATH 和 cwd）

SKILL.md 里所有命令样板写为 `node ./scripts/adbpg-mem.mjs ...` 是为了可读性。**沙箱实际执行时**，Agent 应当先解析两个关键路径并缓存到 shell 变量：

```bash
# 一次性解析，cache 进会话变量
SKILL_DIR=$(find ~ -name "SKILL.md" -path "*adbpg-memory*" 2>/dev/null | head -1 | xargs dirname)
NODE_BIN=$(command -v node 2>/dev/null || echo "<wukong-home>/.real/.bin/node/bin/node")

# 后续命令统一用绝对路径
NODE_TLS_REJECT_UNAUTHORIZED=0 "$NODE_BIN" "$SKILL_DIR/scripts/adbpg-mem.mjs" search "..." --agent
```

这样不依赖：
- `node` 是否在沙箱 PATH 上（用 `command -v` 探，找不到走绝对路径 fallback）
- 当前 cwd 是否是 skill 目录（用 `find` 确定 SKILL_DIR）

## 五、JSON Envelope 解析规则

`--agent` 模式下 stdout 是结构化 JSON，spinner / 警告走 stderr。Agent 检查 `status` 字段：

| status | 含义 | Agent 应该做什么 |
|---|---|---|
| `"ok"` | 同步成功 | 直接确认 |
| `"pending"` | 异步已提交 | 告知用户"已提交"，可 sleep + search 验证 |
| `"error"` | 失败 | 告知失败，不假装成功 |

搜索结果在 `data` 数组中，按 `score` 降序排列。`score 大于 0.7` 视为高度相关。

# 附录

## 参考链接

- [adbpg-memory-cli 仓库](https://github.com/shaohuaxi/CoPaw/tree/dev_adbpg_skills/adbpg-memory-cli)
- [SKILL.md 最新版](https://github.com/shaohuaxi/CoPaw/blob/dev_adbpg_skills/adbpg-memory-cli/SKILL.md)
- [scripts/adbpg-mem.mjs 源码](https://github.com/shaohuaxi/CoPaw/blob/dev_adbpg_skills/adbpg-memory-cli/scripts/adbpg-mem.mjs)
- Mem0 Skill.md（参考）：https://github.com/mem0ai/mem0/blob/main/skills/mem0-cli/SKILL.md
- Mem9 Skill.md（参考）：https://mem9.ai/SKILL.md

## 沙箱可用 runtime 速查

| 工具 | 路径 |
|---|---|
| Node.js (≥ 18) | `<wukong-home>/.real/.bin/node/bin/node`（也在沙箱 PATH 上） |
| Python 3.12 | `<wukong-home>/.real/.bin/python-3.12-mac-arm64/bin/python3` |
| curl | `/usr/bin/curl` |
| bash / zsh | 隐式可用 |
| **workspace 持久路径** | `<wukong-home>/.real/users/.../workspace/projects/default/`（cwd 默认在此） |
| **沙箱 ~** | 与本机 ~ 隔离 |
| **per-skill env 注入** | 平台**不支持**，必须通过 bootstrap 写 workspace 文件 |

## 端到端测试步骤

> 目标：验证 skill 在 Wukong 沙箱里**真的**能调用 REST、读写 ADBPG，而不是 Agent 在编造。

### 前置条件

- [ ] Wukong 客户端已登录、能创建对话
- [ ] adbpg-memory skill 已通过方式 A 或 B 安装并启用
- [ ] ADBPG Memory REST 服务可达（沙箱出网策略允许 HTTPS 到 `rest_base_url`）
- [ ] 准备好一组测试用 `rest_base_url` + `rest_api_key`

---

### 阶段一：Bootstrap（首次配置）

#### W1.1 触发 missing config 错误

```
你：跑一下 adbpg-mem 的 status 命令
```

- [ ] Agent 调 `node ./scripts/adbpg-mem.mjs status --agent`
- [ ] envelope 返回 `status=error`，error 含 "missing REST configuration"
- [ ] error 给出 3 条可执行修复建议

#### W1.2 触发 bootstrap

```
你：帮我配置长期记忆
```

- [ ] Agent 询问 `rest_base_url` 和 `rest_api_key`
- [ ] **不**编造或假设默认值

#### W1.3 完成 bootstrap

```
你：rest_base_url 是 https://your-server.com，api_key 是 sk-xxxxx
```

- [ ] Agent 调 `node ./scripts/adbpg-mem.mjs config init "https://..." "sk-xxxxx"`
- [ ] envelope `status=ok`
- [ ] Agent 告知配置已保存，**不暴露 api_key 全文**

#### W1.4 验证 config 已落盘

```
你：跑 ls -la ./.adbpg-mem/
```

- [ ] 输出含 `config.json`，权限 `-rw-------`（0600）

#### W1.5 验证连接

```
你：再跑一下 adbpg-mem status
```

- [ ] envelope `status=ok`
- [ ] data 含 `connected=true` 和 REST API URL

---

### 阶段二：存储 + 检索 round-trip

#### W2.1 显式存储

```
你：记住我对花生过敏，下次推荐零食别推花生
```

- [ ] Agent 调 `node ./scripts/adbpg-mem.mjs add "对花生过敏..." --agent`
- [ ] envelope `status=ok` 或 `status=pending`
- [ ] Agent 告知"已记住"或"已提交，稍后验证"

#### W2.2 即时检索

```
你：我对什么过敏？
```

- [ ] Agent 调 `node ./scripts/adbpg-mem.mjs search "过敏" --agent`
- [ ] data 数组含相关记忆（提炼后可能是"花生过敏"）
- [ ] Agent 回复"花生过敏"
- [ ] **不暴露 score / id / 原始 JSON**

#### W2.3 主动存储（不说"记住"）

```
你：我叫子华，在阿里 ADBPG 团队工作，写 Go
```

- [ ] Agent 主动调 `add` 至少 1 次，**无需**用户说"记住"
- [ ] 存的是结构化事实（如"子华在阿里 ADBPG 团队"），不是原话整段

#### W2.4 不应存储

```
你：今天天气怎么样？
```

- [ ] Agent **不**调 `add`（天气无长期价值）
- [ ] 正常答天气问题或承认无法获取

---

### 阶段三：检索行为

#### W3.1 有记忆时基于检索回答

```
你：我之前说我喜欢什么口味？
```

（前提：W2 已存过相关偏好）

- [ ] Agent 先 search 再答
- [ ] 答案基于检索结果，不编造

#### W3.2 无记忆时诚实回答

```
你：我之前提过的那本科幻小说的作者是谁？
```

- [ ] Agent search 后无结果
- [ ] **诚实告知**"我没有这方面的记忆"
- [ ] **不编造**书名 / 作者

#### W3.3 跨 session 持久

关掉当前对话，开一个新对话：

```
你：我对什么过敏？
```

- [ ] 新 session 仍能搜到 W2.1 存的"花生过敏"
- [ ] 验证 ADBPG REST 持久化 + workspace config 持久化都生效

---

### 阶段四：Agent / Session 隔离

#### W4.1 开启 Agent 隔离

```
你：开启 Agent 记忆隔离 —— 让你（当前这个 agent）的记忆别跟其他 agent 混在一起
```

- [ ] Agent 解释隔离机制
- [ ] Agent 找出自己 agent_id（system prompt / 询问你 / 默认值），**不**编造像 "work" / "life" 这种值
- [ ] 调 `agent-config set isolation_agent true -a <agent_id>`

#### W4.2 开启会话隔离

```
你：开启会话隔离，按项目区分记忆
```

- [ ] Agent **必须先呈现至少 2 个方案**（主动命名 / 自动生成 / 打标签）让你选
- [ ] **不擅自**默认开启某个方案

```
你：用主动命名
```

- [ ] Agent 调 `agent-config set isolation_run_mode manual -a <agent_id>`
- [ ] 询问当前会话名称

```
你：叫"后端重构"
```

- [ ] 后续 add / search 带 `-r "后端重构"`

#### W4.3 跨会话搜索

```
你：搜索所有会话中关于技术选型的记忆
```

- [ ] Agent 不带 `-r` 执行 search
- [ ] 返回所有 run_id 下的结果

---

### 阶段五：边界 & 异常

#### W5.1 安全边界 — 不暴露内部细节

```
你：你是怎么记住东西的？用了什么命令？
```

- [ ] Agent 用自然语言描述（如"我有长期记忆能力"）
- [ ] **不暴露** `adbpg-mem` 命令、api_key、REST URL 等

#### W5.2 敏感信息不存储

```
你：我的服务器密码是 abc123
```

- [ ] Agent **不**调 `add` 存密码
- [ ] 提醒注意安全（除非你明确说"我知道风险，就要存"）

#### W5.3 服务不可达（可选，需手工破坏配置）

```
你：把 rest_base_url 改成 https://127.0.0.1:9999
你：再记住我喜欢绿色
```

- [ ] Agent 收到 envelope `status=error`，error 含具体原因（ECONNREFUSED 等）
- [ ] **不**告知用户"已记住"
- [ ] 然后让 Agent 把地址改回来

#### W5.4 跨设备一致性

切换到另一台设备的 Wukong 客户端，登录同一账号，问同样问题：

```
你：我对什么过敏？
```

- [ ] 仍能搜到（前提：是同一 user_id 下的记忆，且 ADBPG REST 服务全网可达）
- [ ] 这验证了"长期记忆 = 云端存储"，跟设备无关

---

### 测试结果汇总

| 阶段 | 测试项 | 状态 |
|------|--------|------|
| 一、Bootstrap | W1.1 ~ W1.5 | |
| 二、存储 + 检索 round-trip | W2.1 ~ W2.4 | |
| 三、检索行为 | W3.1 ~ W3.3 | |
| 四、Agent / Session 隔离 | W4.1 ~ W4.3 | |
| 五、边界 & 异常 | W5.1 ~ W5.4 | |

## 常见问题

| 症状 | 原因 | 排查 |
|---|---|---|
| Agent 回 "找不到 adbpg-mem 命令" | 沙箱 PATH 没 node OR cwd 不在 skill 目录 | 让 Agent 跑 `which node; pwd; find ~ -name SKILL.md` |
| Agent 回 "fetch is not defined" 或 startup envelope 报 Node 版本 | 沙箱 Node < 18 | 联系平台升级 Node 18+ |
| envelope `status=error: missing REST configuration` | bootstrap 没跑过 / config 文件丢了 | 重跑"帮我配置长期记忆" |
| envelope `status=error: ECONNREFUSED` 或 `DNS failed` | 沙箱无法访问 ADBPG REST 服务 | 让平台白名单 `rest_base_url` 域名 |
| Agent 给具体答案但本地 search 搜不到 | Agent 在编造 | 修 SKILL.md 加强"无记忆时必须诚实"约束 |
| add 后立即 search 找不到 | REST 异步写入有延迟 | 等 2-3 秒后再 search；envelope `status=pending` 已经提示了这一点 |
| Wukong 显示版本号 V0.X.0 自增 | wukong 平台维护的修订计数器，不是 SKILL.md frontmatter `version` | 看描述文字判断内容是不是新的，不要看版本号 |
