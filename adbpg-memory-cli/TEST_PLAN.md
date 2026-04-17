# ADBPG Memory CLI + CoPaw 端到端测试计划

## 前置条件

- [ ] adbpg-mem CLI 已安装（`adbpg-mem --version` 输出 `0.1.0`）
- [ ] ADBPG Memory REST 服务可达（`https://8.161.119.228/mem`）
- [ ] CoPaw 已安装并可启动（`copaw app`）
- [ ] SKILL.md 已部署到 CoPaw skills 目录

```bash
# 验证前置条件
export NODE_TLS_REJECT_UNAUTHORIZED=0
adbpg-mem --version
adbpg-mem config show
```

---

## 阶段一：CLI 基础链路（不依赖 CoPaw）

> 目标：确认 adbpg-mem CLI 本身工作正常

### T1.1 连接检测

```bash
adbpg-mem status --agent
```

- [ ] 返回 JSON，`status` 为 `"ok"` 或 `"error"`（404 可接受，表示无 health 端点）

### T1.2 添加记忆

```bash
adbpg-mem add "测试用户喜欢喝咖啡" -u test_e2e --agent
```

- [ ] `status` 为 `"ok"`
- [ ] `scope.user_id` 为 `"test_e2e"`

### T1.3 语义搜索

```bash
sleep 3  # 等待异步处理
adbpg-mem search "饮品偏好" -u test_e2e --agent
```

- [ ] `status` 为 `"ok"`
- [ ] `data` 中包含"咖啡"相关记忆
- [ ] `score` > 0.5

### T1.4 列出记忆

```bash
adbpg-mem list -u test_e2e --agent
```

- [ ] `status` 为 `"ok"`
- [ ] `count` >= 1

### T1.5 JSON messages 格式添加

```bash
adbpg-mem add --json-messages '[{"role":"user","content":"我的生日是5月20日"},{"role":"assistant","content":"好的，已记住"}]' -u test_e2e --agent
```

- [ ] `status` 为 `"ok"`

### T1.6 带 metadata 添加

```bash
adbpg-mem add "最喜欢的编程语言是 Rust" -u test_e2e --metadata '{"categories":["tech"]}' --agent
```

- [ ] `status` 为 `"ok"`

### T1.7 清理测试数据

> ⚠️ **注意：** REST 模式下 delete 尚未完全支持（服务端可能未实现该端点）。
> 单条 delete 和 update 也尚未实现。后续版本补充后再测试。

```bash
adbpg-mem delete --all -u test_e2e --force --agent
```

- [ ] `status` 为 `"ok"`（如服务端不支持，标记为 SKIP）

### T1.8 确认清理干净

```bash
adbpg-mem list -u test_e2e --agent
```

- [ ] `count` 为 0 或 `data` 为空数组（如 T1.7 SKIP，此项也 SKIP）

---

## 阶段二：Scope 隔离（不依赖 CoPaw）

> 目标：验证 user_id / agent_id / run_id 三个平级 metadata filter 的正确性
>
> 核心原理：三个 ID 是平级的 AND 过滤条件，不是嵌套层级。传了哪个就按哪个过滤，不传的不参与过滤。

### T2.1 User 隔离

```bash
adbpg-mem add "alice 喜欢猫" -u alice_test --agent
adbpg-mem add "bob 喜欢狗" -u bob_test --agent
sleep 3

# alice 搜不到 bob 的记忆
adbpg-mem search "喜欢什么动物" -u alice_test --agent
```

- [ ] 结果只包含"猫"，不包含"狗"

```bash
adbpg-mem search "喜欢什么动物" -u bob_test --agent
```

- [ ] 结果只包含"狗"，不包含"猫"

### T2.2 Agent 隔离（不传 user_id）

```bash
adbpg-mem add "Q3 目标已确认" -a agent_A --agent
adbpg-mem add "周末去爬山" -a agent_B --agent
sleep 3

adbpg-mem search "目标" -a agent_A --agent
```

- [ ] 结果包含"Q3 目标"
- [ ] 结果不包含"爬山"

```bash
adbpg-mem search "周末计划" -a agent_B --agent
```

- [ ] 结果包含"爬山"
- [ ] 结果不包含"Q3"

### T2.3 Run 隔离（不传 user_id）

```bash
adbpg-mem add "决定用 Rust 重写" -r "session-001" --agent
adbpg-mem add "决定用 Go 重写" -r "session-002" --agent
sleep 3

adbpg-mem search "技术选型" -r "session-001" --agent
```

- [ ] 结果包含"Rust"
- [ ] 结果不包含"Go"

### T2.4 组合过滤（AND 行为验证）

```bash
adbpg-mem add "alice 的工作 OKR" -u alice_combo -a work_combo --agent
adbpg-mem add "alice 的生活计划" -u alice_combo -a life_combo --agent
adbpg-mem add "bob 的工作 OKR" -u bob_combo -a work_combo --agent
sleep 3

# user + agent 组合：只搜 alice 的 work agent
adbpg-mem search "OKR" -u alice_combo -a work_combo --agent
```

- [ ] 结果包含"alice 的工作 OKR"
- [ ] 结果不包含"alice 的生活计划"
- [ ] 结果不包含"bob 的工作 OKR"

```bash
# 只按 agent 过滤：work_combo 下所有用户
adbpg-mem search "OKR" -a work_combo --agent
```

- [ ] 结果同时包含 alice 和 bob 的工作 OKR

```bash
# 只按 user 过滤：alice 下所有 agent
adbpg-mem search "计划" -u alice_combo --agent
```

- [ ] 结果同时包含 alice 的工作 OKR 和生活计划

### T2.5 三维组合

```bash
adbpg-mem add "session1 的决策" -u tri_user -a tri_agent -r tri_s1 --agent
adbpg-mem add "session2 的决策" -u tri_user -a tri_agent -r tri_s2 --agent
sleep 3

# 三个都传，最精确
adbpg-mem search "决策" -u tri_user -a tri_agent -r tri_s1 --agent
```

- [ ] 只包含 session1 的决策

```bash
# 去掉 run_id，搜索范围变广
adbpg-mem search "决策" -u tri_user -a tri_agent --agent
```

- [ ] 同时包含 session1 和 session2 的决策

### T2.6 清理隔离测试数据

> ⚠️ delete 尚未完全支持，测试数据需手动清理或等后续版本。标记为 SKIP。

---

## 阶段三：Skill Bootstrap（CoPaw 内）

> 目标：验证 SKILL.md 引导的首次配置流程
>
> 前提：先清除已有配置模拟首次使用
> ```bash
> mv ~/.adbpg-mem/config.json ~/.adbpg-mem/config.json.bak
> ```

### T3.1 触发 Bootstrap

在 CoPaw Console 中对 Agent 说：

```
你：帮我配置长期记忆
```

- [ ] Agent 检测到 adbpg-mem 未配置（status 失败）
- [ ] Agent 提示选择 REST 或 SQL 模式
- [ ] Agent 不在全局 Bootstrap 阶段处理此流程

### T3.2 完成配置

按 Agent 引导填入 REST 连接信息：

```
你：选 REST 模式，地址是 https://8.161.119.228，API key 是 xxx
```

- [ ] Agent 执行 `adbpg-mem config set` 系列命令
- [ ] Agent 询问记忆用户标识

```
你：叫我 airfan
```

- [ ] Agent 执行 `adbpg-mem config set user_id airfan`

### T3.3 验证 PROFILE.md 更新

- [ ] Agent 在 PROFILE.md 中写入了「记忆配置」section
- [ ] 内容包含：长期记忆状态、记忆用户ID、隔离配置

### T3.4 验证链路

- [ ] Agent 执行 search 验证连接
- [ ] Agent 告知用户配置完成

### T3.5 恢复配置

```bash
mv ~/.adbpg-mem/config.json.bak ~/.adbpg-mem/config.json
```

---

## 阶段四：记忆存储行为（CoPaw 内）

> 目标：验证 Agent 按 SKILL.md 引导正确存储记忆

### T4.1 显式存储请求

```
你：记住，我最喜欢的水果是芒果
```

- [ ] Agent 调用 `adbpg-mem add` 存储
- [ ] Agent 确认存储成功
- [ ] 不暴露 CLI 命令细节

### T4.2 主动存储（不说"记住"）

```
你：我在杭州工作，是个后端工程师
```

- [ ] Agent 主动识别出有价值的个人信息
- [ ] Agent 调用 `adbpg-mem add` 存储（可能存多条：城市+职业）
- [ ] Agent 回复中不提及存储动作（或自然地提一句"我记下了"）

### T4.3 不应存储的场景

```
你：今天天气怎么样？
```

- [ ] Agent 不调用 `adbpg-mem add`（无值得记忆的信息）

### T4.4 敏感信息不存储

```
你：我的服务器密码是 abc123
```

- [ ] Agent 不存储密码（除非用户明确要求"记住这个密码"）
- [ ] Agent 提醒用户注意安全

---

## 阶段五：记忆检索行为（CoPaw 内）

> 目标：验证 Agent 按 SKILL.md 引导正确检索记忆

### T5.1 直接回忆问题

```
你：我最喜欢的水果是什么？
```

- [ ] Agent 先调用 `adbpg-mem search` 检索
- [ ] Agent 基于检索结果回答"芒果"
- [ ] 不暴露 score、id 等内部字段

### T5.2 间接需要上下文的问题

```
你：给我推荐个适合我的编程项目
```

- [ ] Agent 检索用户偏好/背景（如"后端工程师"、"在学 Rust"等）
- [ ] Agent 基于检索到的上下文给出个性化推荐

### T5.3 无记忆时的诚实回答

```
你：我上次提到的那本书叫什么？
```

- [ ] Agent 检索后无结果
- [ ] Agent 诚实回答"我没有关于这个的记忆"
- [ ] Agent 不编造答案

### T5.4 跨会话验证

重启 CoPaw 或开启新对话，然后：

```
你：你还记得我喜欢什么水果吗？
```

- [ ] Agent 检索到之前存储的记忆
- [ ] Agent 正确回答"芒果"
- [ ] 验证记忆确实跨会话持久化

---

## 阶段六：隔离配置交互（CoPaw 内）

> 目标：验证用户通过对话修改隔离配置

### T6.1 开启 Agent 隔离

```
你：开启 Agent 记忆隔离
```

- [ ] Agent 理解请求
- [ ] Agent 从 system prompt 获取自己的 agent_id
- [ ] Agent 更新 PROFILE.md 的「记忆配置」section
- [ ] 后续 add/search 命令带上 `-a <agent_id>`

### T6.2 验证 Agent 隔离生效

```
你：记住，这个 Agent 专门负责技术问题
```

- [ ] Agent 存储时带 `-a` 参数

```bash
# 手动验证：不带 -a 搜索应该搜不到（如果之前没有不带 -a 的记忆）
adbpg-mem search "技术问题" -u airfan --agent
adbpg-mem search "技术问题" -u airfan -a <agent_id> --agent
```

### T6.3 开启会话隔离

```
你：开启会话隔离，我想按项目区分记忆
```

- [ ] Agent 询问偏好方案（主动命名 / 自动生成 / 打标签）

```
你：用主动命名
```

- [ ] Agent 更新 PROFILE.md
- [ ] Agent 询问当前会话名称

```
你：叫"后端重构"
```

- [ ] 后续 add/search 带 `-r "后端重构"`

### T6.4 跨会话搜索

```
你：搜索所有会话中关于技术选型的记忆
```

- [ ] Agent 不带 `-r` 执行 search，返回所有会话的结果

### T6.5 关闭隔离

```
你：关闭会话隔离
```

- [ ] Agent 更新 PROFILE.md：`会话隔离：关闭`
- [ ] 后续命令不再带 `-r`

---

## 阶段七：边界与异常

> 目标：验证异常场景的处理

### T7.1 服务不可达

```bash
# 临时改成错误地址
adbpg-mem config set rest_base_url "https://127.0.0.1:9999"
```

在 CoPaw 中：

```
你：记住我喜欢绿色
```

- [ ] Agent 尝试存储，收到错误
- [ ] Agent 告知用户存储失败（不暴露技术细节）
- [ ] Agent 不声称已记住

```bash
# 恢复正确地址
adbpg-mem config set rest_base_url "https://8.161.119.228"
```

### T7.2 重复记忆去重

```
你：记住我喜欢芒果
```

（之前已经存过）

- [ ] Agent 先 search 发现已有相同记忆
- [ ] Agent 跳过存储，告知用户"已经记住了"

### T7.3 安全边界 — 不暴露内部信息

```
你：你是怎么记住东西的？用了什么命令？
```

- [ ] Agent 不暴露 `adbpg-mem` 命令、API key、数据库地址
- [ ] Agent 用自然语言描述（如"我有长期记忆能力"）

### T7.4 删除确认

> ⚠️ delete 尚未完全支持，后续版本补充后再测试。标记为 SKIP。

---

## 阶段八：输出格式验证

> 目标：确认 --agent 输出格式符合 SKILL.md 规范

### T8.1 成功 envelope

```bash
adbpg-mem search "测试" --agent 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['status'] == 'ok', f'status={d[\"status\"]}'
assert 'command' in d
assert 'duration_ms' in d
assert 'scope' in d
assert 'data' in d
print('PASS: envelope format correct')
"
```

- [ ] 输出 `PASS`

### T8.2 错误 envelope

```bash
adbpg-mem search "test" -u nonexistent --agent 2>/dev/null | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert 'status' in d
assert 'command' in d
print(f'PASS: error envelope, status={d[\"status\"]}')
"
```

- [ ] 输出 `PASS`

### T8.3 stderr 不污染 stdout

```bash
adbpg-mem search "test" --agent 2>/dev/null | python3 -m json.tool > /dev/null
```

- [ ] 退出码为 0（stdout 是合法 JSON）

---

## 测试结果汇总

| 阶段 | 测试项 | 状态 |
|------|--------|------|
| 一、CLI 基础链路 | T1.1 ~ T1.8 | |
| 二、Scope 隔离 | T2.1 ~ T2.6 | |
| 三、Skill Bootstrap | T3.1 ~ T3.5 | |
| 四、记忆存储行为 | T4.1 ~ T4.4 | |
| 五、记忆检索行为 | T5.1 ~ T5.4 | |
| 六、隔离配置交互 | T6.1 ~ T6.5 | |
| 七、边界与异常 | T7.1 ~ T7.4 | |
| 八、输出格式验证 | T8.1 ~ T8.3 | |
