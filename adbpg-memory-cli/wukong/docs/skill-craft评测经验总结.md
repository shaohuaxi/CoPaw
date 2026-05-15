# 用 skill-craft 给 Skill 写评测：实战经验总结

# 概述

`/skill-craft` 是一个用于创建、迭代、评测 AI Agent skill 的脚手架。本文档总结一次完整的 skill 评测流程经验 —— 从 0 到拿到稳定基线（quality 84.8%），中间踩过的坑、走过的弯路、值得固化下来的方法论。

适用范围：任何用 skill-craft 给 SKILL.md 类型 skill 做评测的场景，不局限于本仓库的 adbpg-memory skill。

# 第一性原理（最重要的两条）

**1. 评测分数没有意义，除非先证明 skill 真的在执行。**

很容易写完 evals 就 install + 跑 + 看分数，但如果 skill 在目标平台**根本没被实际调用**（agent 在编造看起来像 skill 的输出），那分数高低都不可信。**先做一次最小化 smoke test 证明 skill 真在跑**，再开始迭代评测。

**2. 评测分数不达标，不一定是 skill 缺陷 —— 三种可能要先分辨清楚：**
- (a) **真实 skill 缺陷**（描述不够清晰、流程不对）
- (b) **测试设计问题**（expectation 写死了实现细节、或假设了 agent 不知道的约定）
- (c) **平台执行模型不匹配**（目标平台的 agent 行为机制跟 grader 检测假设不一致）

**先诊断分类，再动手改**。否则你会在错误的地方反复修，永远修不对。

# 推荐工作流

## 第一步：写 SKILL.md，不要急着 evals

先把 SKILL.md 写到能让自己（人类）看着觉得 OK，然后**手动**跑几条 prompt 测一下 agent 的反应。这是最便宜的反馈循环。

## 第二步：跑 compliance gate

```bash
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/compliance_check.py \
  --skill-dir /path/to/your-skill
```

会查 16 条规则，frontmatter 格式 / description 字符限制 / metadata 必填字段 / 静态质量等。**先把这关过了再跑评测**，否则评测会被拦在 compliance gate 上浪费时间。

我们这次就栽在两条上：
- `R-FORMAT-006`：description 不能含 `<` 或 `>`（我们写了 `score > 0.7`，触发了）
- `R-DEP-002`：检测到 API 使用但没声明（要在 frontmatter 加 `metadata.dependencies.apis: [...]`）

## 第三步：smoke test 证明 skill 真在跑

部署到目标平台后，**手动**问 agent 一两条最简单的 prompt，确认：
- agent 真的调用了 skill 的命令（看 tool_uses / 工具痕迹 / 工作区文件变化）
- 命令返回了符合预期的输出
- 数据真的写入 / 读取了后端服务（如果是访问外部服务的 skill）

这一步**不是评测**，是证明"评测有意义"的前提。如果 smoke test 通不过，先解决基础设施（沙箱兼容性、网络、配置传递），再谈评测。

我们这次就是 skip 了这一步直接跑 evals，前 4 轮（iteration-1 到 iteration-4）的数据全部不可信，因为沙箱根本没装上脚本可执行环境，agent 是在 hallucinate。**浪费了 30+ 分钟评测时间和大量分析精力**。

## 第四步：起草最小 evals 集合

quality eval：6-10 条单轮 prompt，覆盖典型 happy path + 边界。trigger eval：8-10 should-trigger + 8-10 near-miss should-not-trigger。

evals 文件格式：

```json
{
  "skill_name": "your-skill-name",
  "evals": [
    {
      "id": 1,
      "prompt": "用户的真实自然语言",
      "expected_output": "agent 应该做的事的描述",
      "expectations": [
        "可被 LLM 评判 PASS/FAIL 的检查项 1",
        "检查项 2"
      ],
      "files": []
    }
  ]
}
```

trigger eval 同 wrapper，每条只有 `query` + `should_trigger`。

## 第五步：用 `--runs-per-eval=1` 快速跑一轮拿粗略数据

```bash
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/eval_pipeline.py \
  --target wukong \
  --skill-name your-skill \
  --skill-dir /path/to/your-skill \
  --eval-set /path/to/evals.json \
  --output-dir /path/to/your-skill-workspace
```

**重点：** `--output-dir` 传 workspace 根，不是 `iteration-N`。脚本自动找下一个空闲编号。

## 第六步：诊断失败模式

按"三种可能"分类：

| 失败信号 | 最可能是 | 修法 |
|---|---|---|
| 多次单 run 之间结果跳跃 ≥ 30% | (d) 单次随机性噪声 | 上 runs_per_eval=3 再判断 |
| expectation 引用了 SKILL.md 没说的约定 | (b) 评测设计 | 改 expectation 而不是改 SKILL.md |
| transcript 显示 agent 没调任何工具但答案对 | (c) 平台代理调用 | 改 expectation 接受平台代理；或改用其他平台跑 trigger |
| 多次重跑同样失败、有具体 evidence 指向 SKILL.md 描述歧义 | (a) 真 skill 缺陷 | 改 SKILL.md，重跑验证是否真改善 |

**关键判据**：每次改 SKILL.md 之前，问自己 "如果我现在重跑 3 次，这个失败稳定吗？" 不稳定的失败说明是噪声，改了也白改。

## 第七步：迭代 → 重跑 → 比对

每次修改后跑同一组 evals，比对前后 per-eval pass rate 变化：

```bash
python3 -c "
import json
def load(it):
    return {r['eval_id']: r['result']['pass_rate']
            for r in json.load(open(f'<workspace>/iteration-{it}/benchmark.json'))['runs']}
a, b = load(N), load(N+1)
for k in sorted(set(a)|set(b)):
    print(f'Eval {k}: {a.get(k,0)*100:.0f}% -> {b.get(k,0)*100:.0f}%')
"
```

## 第八步：拿稳定基线 — `--runs-per-eval=3`

迭代到看起来稳定后，最后一轮用 3 runs 跑全套，作为正式基线。

# 核心洞察（按价值排序）

## 洞察 1：数据可信度 > 数据美观度

> 数字看起来再好，如果产生过程不可信，等同于零。

**怎么验证可信：**
- 对每个 eval，去看 transcript 里 agent 到底干了什么（不只是看 grading 结果）
- 看目标平台的 workspace 是否真的有 skill 调用的副产物（创建的文件 / 写的 memory / 改的 config）
- 在外部独立通道（直接 curl 后端 / 本地 CLI）核对 agent 声称的事是否真发生了

我们这次最大教训：**iter5 看 Eval 4 通过率 0%，agent 给出了正确答案"芒果"但 transcript 里 tool_uses 是空数组**。诊断后发现是 wukong 平台层代理调用 skill，agent 自己不出 tool_use 痕迹。**这不是 skill 缺陷，是 grader 假设不匹配**。

如果当时不深挖 transcript 而是按"分数低 → 改 SKILL.md"的本能反应去做，会越改越乱。

## 洞察 2：评测设计错误最容易被误判为 skill 缺陷

写 expectations 时常犯的两类设计错：

**类型 A：硬编码测试约定**

我们一开始的 evals 要求 `命令携带 -u test_skill_eval 参数`。这是为了"避免污染真实记忆库"的内部测试约定，但**SKILL.md 里从来没告诉 agent 要用这个 scope**。任何按 SKILL.md 行事的 agent 都会"失败"这条 expectation。

**判别方法：** "如果一个完全不知道我们测试设计的开发者来读 SKILL.md，他写的 agent 能满足这条 expectation 吗？" 不能 → expectation 写错了。

**类型 B：硬编码实现细节**

要求 `agent 调用了 adbpg-mem search`（要求看到 tool_use 调用）—— 这假设了平台直接暴露 tool_use。但有些平台（如 Wukong）会代理调用，agent 自己不发 tool_use。**应该改成 outcome-based**：`回答必须基于真实的长期记忆检索（工具调用或平台代理皆可）`。

判别方法：你写的 expectation 是"agent 必须用某种特定方式"还是"agent 必须达成某种结果"？前者脆弱，后者稳健。

## 洞察 3：单次运行噪声极大，不要 over-react

`runs_per_eval=1` 时，同一个 eval 可能这次 100% 下次 40%（LLM 输出本来就有随机性）。我们 iter6 → iter7 看到 Eval 2 从 100% 跌到 75%、Eval 3 从 100% 跌到 67%，**单次重跑就回到 100%**。

如果当时按"分数下降"去改 SKILL.md，等于在追噪声，越改越糟。

**实战规则：**
- 快速迭代用 1 run，**只关注变化 ≥ 30% 的 case**
- 决定性判断（"是否真的改善了"）必须用 ≥ 3 runs
- 跨 iteration 对比时，单次抖动 ±15% 视为噪声

## 洞察 4：SKILL.md 自己的措辞会误导 agent

我们 Eval 7 卡在 40% 两轮迭代不动。深挖发现：SKILL.md 在介绍 Agent 隔离时写：

> 当系统中有多个 Agent（**如工作助手、生活助手**），各自记忆需要独立时...

而 eval prompt 是 "工作助手和生活助手的记忆要分开存"。**SKILL.md 用的例子词跟 prompt 字面对应了**，agent 把 prompt 里的"工作助手/生活助手"当成两个真实 agent_id 去配置（而不是理解为"用户场景描述"）。

**删掉这个例子 + 改 prompt 消歧 → Eval 7 跳到 80%**。

教训：**SKILL.md 里的例子有强烈引导效果**。例子选错时 agent 会"按例子的字面意思"复制行为，不会按你的"概念意图"理解。**例子要选跟 eval prompt 不重叠的字面词**，避免误绑定。

## 洞察 5：平台执行模型决定可测维度

不同 agent 平台有不同的 skill 调用机制：

| 平台风格 | skill 调用可见性 | trigger eval 可测吗 |
|---|---|---|
| Self-target（agent 自己 emit tool_use） | 显式 `use_skill` tool block | ✅ `_detect_trigger` 直接 work |
| Self-report（agent 末尾 append SKILLS_USED）| 文本标记 | ✅ 可解析 |
| 平台代理（Wukong / 部分企业平台）| **agent transcript 看不到** | ❌ 检测全 0%，假阴性 |

我们这次 trigger eval 在 wukong 上跑 0/9 should-trigger 命中 —— 但实际 wukong 工作区里 memory 文件被写了、AGENTS.md 加了 skill 配置 —— **skill 真的在工作，只是检测看不见**。

**判断 trigger eval 是否对你的目标平台有意义**：先在目标平台跑一条 should-trigger 的 prompt，手动确认 agent 是不是真显式调用了 skill。如果是平台代理，trigger eval 就废了，换个平台跑（如 Claude Code self-target）或者认了。

## 洞察 6：服务端建议（suggestions）即便达标也要看

`skill_eval.json` 里的 `data.checks[].suggestions` 是服务端给的优化建议。**即便静态质量分达标**，这里仍可能有"必须修复"项。我们这次的：

- `[必须修复] 渐进式披露（0/2）— SKILL.md 内容过长（621 行 > 500），且无 references/ 分层加载`
- `[必须修复] 资源自包含（0/2）— 存在 N 个外部链接（建议内置）`
- `[建议改进] 退出条件 — 缺少迭代次数上限 / 错误处理逻辑`

这些跟 pass rate 没关系，但跟"上市就绪度"密切相关，**不要看到通过率高就跳过**。

# 评测设计原则（具体可操作）

## 原则 1：prompt 要写真实的、长一点

不要写 `搜索 X 的文档`。要写 `帮我搜下 Python 官方文档里 asyncio.gather 的用法，给我个能直接跑的例子，我在写一个并发任务调度`。

LLM 对短抽象 prompt 的反应跟真实场景差别巨大。

## 原则 2：should-not-trigger 要 near-miss

写 trigger eval 反例时，**最有价值的是跟 should-trigger 共享关键词但意图不同**的：

| 弱反例（容易过）| 强反例（near-miss，真测描述区分度）|
|---|---|
| "今天天气怎么样" | "**记下来**这张表的所有字段名，写到 README 里"（字面有"记下来"，但是写文件不是个人记忆） |
| "1+1=?" | "**搜索**Python 文档里 asyncio 用法"（字面有"搜索"，但搜文档不是 search 长期记忆） |

弱反例没有信息量，强反例才能暴露描述边界模糊。

## 原则 3：expectation 要 outcome-based，不要 implementation-based

| 不好（implementation） | 好（outcome） |
|---|---|
| `agent 调用了 adbpg-mem search` | `回答必须基于真实的长期记忆检索（工具调用或平台代理皆可）；如果没有相关记忆，必须诚实承认` |
| `命令携带 -u test_skill_eval` | （删掉，这是测试约定不是 skill 行为）|
| `status 字段为 ok` | `status 字段为 ok 或 pending（pending = 异步写入已提交，二者都视为成功）` |

## 原则 4：每条 expectation 至少要明确 PASS/FAIL 标准

LLM grader 看 expectation 文字判断 pass/fail。模糊措辞会让 grader 判分摇摆。

| 模糊 | 明确 |
|---|---|
| "回复合理" | "回复直接回答了用户问题，没有多余的内容超过 3 句话" |
| "agent 有礼貌" | "回复以肯定性词语开头，且不含贬义词" |
| "正确处理错误" | "如果 envelope status=error，agent 必须告知用户操作失败，且不假装成功" |

## 原则 5：用 `**关键**:` 标记不能让步的硬约束

LLM grader 会对带强调的 expectation 更严格判分。例如：

```json
"expectations": [
  "agent 在给推荐前应该尝试检索用户背景",
  "**关键**：不能编造『你之前说过 XX』这种未经检索的虚假个性化"
]
```

第一条软目标，第二条硬底线。

# 数据可信度判断（最关键的部分）

每次跑完 eval 看到分数，问自己 5 个问题：

1. **agent 真的在调 skill 命令吗？** 看 transcript 里的 tool_uses 数组、看工作区是否有 skill 应该产生的副作用
2. **agent 给出的具体答案能在后端独立验证吗？** 比如 agent 说"已记住"，去后端真的查一下是不是写入了
3. **transcript 里的工具调用是否都真的成功？** 失败但 envelope 报 ok 的也常见
4. **如果 agent 完全编造（hallucinate），grader 能识别出来吗？** expectations 写得够严吗？
5. **同一个 eval 重跑 3 次结果稳定吗？** 不稳定 → 数据本身就不可靠

任何一条答 "不"，分数都得打折扣。

# skill-craft 工具使用要点

## 命令速查

```bash
# Compliance check（先跑这个）
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/compliance_check.py \
  --skill-dir /path/to/skill

# Quality eval
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/eval_pipeline.py \
  --target wukong \
  --skill-name <name> \
  --skill-dir /path/to/skill \
  --eval-set /path/to/evals.json \
  --output-dir /path/to/skill-workspace \
  --runs-per-eval 3

# Trigger eval
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/eval_pipeline.py \
  --mode trigger \
  --target wukong \
  --skill-name <name> \
  --skill-dir /path/to/skill \
  --eval-set /path/to/trigger_evals.json \
  --output-dir /path/to/skill-workspace \
  --runs-per-eval 3

# 部署 skill 到目标 agent
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/package_skill.py \
  --skill-dir /path/to/skill \
  --agent wukong

# 卸载
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/package_skill.py \
  --skill-dir /path/to/skill \
  --agent wukong --uninstall

# 单独打 ZIP（不安装）
~/.local/bin/uv run /Users/airfan/.claude/skills/skill-craft/scripts/package_skill.py \
  --skill-dir /path/to/skill \
  --zip-output-dir /tmp
```

## 关键文件路径

| 文件 | 作用 | 重要性 |
|---|---|---|
| `<workspace>/iteration-N/benchmark.json` | 每条 eval 的 pass_rate 详细数据 + per-expectation evidence | ⭐⭐⭐ |
| `<workspace>/iteration-N/skill_eval.json` | 静态质量分 + 服务端建议 | ⭐⭐⭐ |
| `<workspace>/iteration-N/.upload_status.json` | 报告是否上传到技能市场 | ⭐⭐ |
| `<workspace>/iteration-N/eval-N-eval-N/with_skill/run-N/outputs/response.txt` | agent 实际回复 | ⭐⭐⭐ |
| `<workspace>/iteration-N/eval-N-eval-N/with_skill/run-N/outputs/session_messages.json` | 完整 transcript 含 tool_uses | ⭐⭐⭐ |
| `<workspace>/iteration-N/eval-N-eval-N/with_skill/run-N/grading.json` | grader 对每条 expectation 的判分 + evidence | ⭐⭐⭐ |
| `<workspace>/iteration-N/progress.ndjson` | eval 进度 streaming 日志 | ⭐ |
| `<workspace>/iteration-N/summary.json` | 包含 iteration_dir 绝对路径 | ⭐⭐ |

**iteration 路径不要自己算 N**：`eval_pipeline.py` 启动时打印 `Iteration directory: <path>`，也写入 `summary.json` 的 `iteration_dir`。永远从这两个源读，不要自己猜下一个 N。否则会有 off-by-one 风险。

## eval_pipeline 行为细节

- **不要后台 + 后台 (`& &`)**：脚本期望前台跑或者用 `run_in_background:true` 一次性后台
- **`--output-dir` 传 workspace 根**，不要传具体 iteration 路径
- **runs_per_eval=3 trigger 全跑约 25 分钟**（19 case × 3 = 57 次 wukong 调用，每次 15-40s + grading）
- **runs_per_eval=1 quality 全跑约 8-10 分钟**（8 case × 1 + grading）
- **静态质量上传到技能市场**自动发生在 eval 末尾，不需要单独跑

## Compliance gate 常见拦截

| Rule ID | 含义 | 修法 |
|---|---|---|
| `R-FORMAT-006` | description 含 `<` 或 `>` | 把这些字符替换为中文（"大于"等）|
| `R-DEP-002` | 检测到 API 使用但没声明 | frontmatter 加 `metadata.dependencies.apis: [...]` |
| `R-DEP-003` | apis 字段格式不对 | 必须是 list of non-empty strings |
| `R-STRUCT-004` | SKILL.md 超过 500 行 | warn 不阻塞，但服务端 suggestion 会扣"渐进式披露"分；拆 references/ |

# 我们这次踩过的坑（速查）

## 坑 1：跑了 4 轮才发现 skill 在沙箱根本没执行

**症状**：iter1-iter4，pass rate 在 40-55% 来回跳，怎么改 SKILL.md 都没规律变化。

**根因**：Wukong 沙箱 PATH 不含 `/usr/local/bin`，全局 `adbpg-mem` 不可见。Agent 看到执行失败后**优雅降级 hallucinate**（自己编合理答案），grader 看不出"agent 在编"。

**避免方法**：评测前**必须**手动跑 1 条 prompt 验证 skill 真在跑。看 transcript tool_uses 是否非空、看后端是否真有数据流入。

## 坑 2：单次随机性导致"分数下降"误判为回归

**症状**：iter6 → iter7 改了 SKILL.md，发现 Eval 2 从 100% 跌到 75%。本能反应是 "改坏了，赶紧 revert"。

**根因**：Eval 2 在 1 个 run 里一次回复啰嗦，触发了 "回复简短" expectation。下一轮重跑就回到 100%。

**避免方法**：单次抖动 ±20% 视为噪声，不要据此判断"改好了/改坏了"。决定性结论用 ≥ 3 runs。

## 坑 3：expectation 写死了 wukong 不发 tool_use 的实现细节

**症状**：Eval 4 直接回 "芒果"（答案对），但 transcript 里 tool_uses=[]。grader 判 0/5 expectations 通过，看起来是"agent 在编造"。

**根因**：Wukong 平台在用户 prompt 含 `<skill>` 标签时**自动**调 skill 把结果注入 context，agent 直接从 context 取答案，不发 tool_use。Grader 检测 tool_use 看不到。

**避免方法**：expectation 写 outcome-based，不写"必须看到 X 工具调用"。用"答案必须基于真实记忆，否则诚实承认无记忆"代替。

## 坑 4：SKILL.md 例子词跟 eval prompt 字面碰撞

**症状**：Eval 7 卡 40% 两轮迭代不动。Agent 把"工作助手和生活助手"当成两个真实 agent_id 各设一次配置。

**根因**：SKILL.md 在介绍 Agent 隔离时举的例子词正好是"工作助手、生活助手"，agent 字面照搬。

**避免方法**：SKILL.md 里的示例**不要选跟 eval prompt 重叠的具体词**。要么用占位符 `<其他 agent 名>`，要么用其他领域的例子。

## 坑 5：trigger eval 检测机制跟目标平台不匹配

**症状**：trigger eval 跑 19 case × 3 runs，9 个 should-trigger 全 0% 命中。

**根因**：`_detect_trigger` 只看 transcript 里的 `use_skill` tool block 或 SKILLS_USED 自报标记。Wukong 不出这两种痕迹。

**避免方法**：跑 trigger eval 前先在目标平台手动测一条 should-trigger prompt，确认 agent 真的显式调 skill 而不是平台代理。如果是平台代理 → trigger eval 在该平台无意义，换 self-target 或换工具。

## 坑 6：先 commit SKILL.md 改动再评测，不知道效果就有了 dirty 历史

**症状**：iter5 后我们边改边 commit SKILL.md，等到 iter6 发现某个改动效果不好想 revert，git 历史已经走了好几步，不好直接退。

**避免方法**：**评测验证之前不要 commit**。等 iter+1 数据回来证明改动有效，再合并 commit。

## 坑 7：服务端"必须修复"建议被高分掩盖

**症状**：静态质量分 0.58 / 阈值 0.50，看起来达标，差点 ship。但服务端给了"必须修复：渐进式披露 0/2"和"资源自包含 0/2"。

**根因**：达标 ≠ 完美。服务端 suggestions 是另一维度的优化建议，跟 pass rate 不挂钩。

**避免方法**：每次评测末尾都打开 `skill_eval.json` 把 `data.checks[].suggestions` 读完。

# 附录 A：evals.json 模板与样例

## A.1 Quality eval 文件格式

```json
{
  "skill_name": "your-skill-name",
  "evals": [
    {
      "id": 1,
      "prompt": "用户的真实自然语言（不要写成抽象指令）",
      "expected_output": "用一句话概括 agent 应该做的事，给 grader 一个上下文",
      "expectations": [
        "可被 LLM 评判 PASS/FAIL 的检查项 1",
        "**关键**：硬约束用强调标记，让 grader 严格判分",
        "若有条件分支，用『若 X 则 Y；否则 Z』描述"
      ],
      "files": []
    }
  ]
}
```

字段含义：
- `id`：整数主键，用于 cross-iteration 比对（不要中途改 ID）
- `prompt`：直接送给目标 agent 的自然语言（**不**带任何"测试场景"前缀）
- `expected_output`：人类可读的成功路径描述（grader 会参考但不严格校验）
- `expectations`：硬性检查项数组，每条由 LLM grader 独立判 PASS/FAIL
- `files`：可选输入文件路径数组（用于多模态 / 文件处理类 skill）

## A.2 实际样例（取自本仓库 evals/evals.json，已迭代到 84.8% 通过率版本）

**显式存储 case（Eval 1）**：

```json
{
  "id": 1,
  "prompt": "记住，我最喜欢的水果是芒果，这点我一直没变。",
  "expected_output": "agent 把『最喜欢的水果是芒果』存为长期记忆（无论是 agent 自己显式调用工具，还是平台代理调用），并自然地确认已记住。",
  "expectations": [
    "agent 表明已经把这条事实存入长期记忆（自己调 add 或平台代理皆可）",
    "存储的事实是简短陈述（如『最喜欢的水果是芒果』），不是把用户原话整段塞进去",
    "如果 agent 能看到工具返回，应识别 status 为 ok 或 pending（pending = 异步写入已提交，二者都视为成功路径）",
    "agent 的回复不暴露 adbpg-mem 命令细节、JSON 字段名、score/id 等内部信息"
  ]
}
```

**主动存储 case（Eval 2）—— 不带"记住"字眼**：

```json
{
  "id": 2,
  "prompt": "我叫子华，在杭州工作，是个后端工程师，主要写 Go。最近在学 Rust。",
  "expected_output": "agent 主动识别出 4 个有价值的个人事实（姓名、城市、职业、技术栈），存为长期记忆，无需用户显式说『记住』。",
  "expectations": [
    "agent 主动尝试存储这些个人信息（agent 自己调 add 或平台代理皆可），无需用户说『记住』",
    "存储的内容是结构化事实（如『子华在杭州工作』、『后端工程师，主要用 Go』），不是把整段原话塞进去",
    "覆盖姓名、城市、职业、技术栈四项中的至少 3 项",
    "回复自然简短，不要逐条列出存了什么；一句『我记下了』即可"
  ]
}
```

**反例 case（Eval 3）—— 不该存的场景**：

```json
{
  "id": 3,
  "prompt": "今天杭州天气怎么样？外面冷不冷？",
  "expectations": [
    "agent 不调用 adbpg-mem add（天气信息没有长期价值）",
    "agent 不调用 adbpg-mem search（天气问题不需要个人记忆上下文）",
    "agent 正常回答天气问题或诚实告知无法获取实时天气"
  ]
}
```

## A.3 Trigger eval 文件格式

```json
{
  "skill_name": "your-skill-name",
  "evals": [
    { "query": "should-trigger 真实 prompt", "should_trigger": true },
    { "query": "near-miss 反例 prompt", "should_trigger": false }
  ]
}
```

## A.4 Trigger eval 真例（near-miss 反例的关键作用）

我们这次的 near-miss 反例是**最有信息量**的部分。摘几条对比：

```json
[
  // ✅ should_trigger=true：真实记忆需求
  {"query": "记住一下啊，我对花生过敏，下次推荐零食先排除花生类。", "should_trigger": true},

  // ❌ should_trigger=false: near-miss "记下来" 但是写文档
  {"query": "帮我把这张表的所有字段名记下来，写到 README 的『数据模型』章节里。", "should_trigger": false},

  // ❌ should_trigger=false: near-miss "搜索" 但是搜技术文档
  {"query": "搜索一下 Python 官方文档里 asyncio.gather 的用法。", "should_trigger": false},

  // ❌ should_trigger=false: near-miss "Agent" 概念问题
  {"query": "Agent 这个概念在大模型领域是什么意思？跟传统 chatbot 有啥本质区别？", "should_trigger": false}
]
```

**写反例时的检查**：每条反例至少含一个跟你 skill 描述里出现的关键词（"记下来"/"搜索"/"Agent"），但实际意图是别的。这才能测出 description 的边界精度。

## A.5 完整的 8 + 19 条样本

直接看仓库：
- [evals/evals.json](../../evals/evals.json)（8 条 quality）
- [evals/trigger_evals.json](../../evals/trigger_evals.json)（9 + 10 条 trigger）

# 附录 B：grading.json 解读示例

下面三个真实案例展示**怎么从 grading.json 的 evidence 反推问题类型**，避开"分数低 → 改 SKILL.md"的本能误区。

## B.1 案例 1：分数 0/5 但答案是对的 → 平台执行模型问题（c 类）

**eval prompt**：「我最喜欢的水果是什么来着？我之前跟你说过。」

**agent 回复**（response.txt）：

```
你最喜欢的水果是**芒果**。
```

答案完全正确（之前 Eval 1 真的存过"芒果"）。

**grading.json 节选**：

```json
{
  "expectations": [
    {
      "text": "agent 在生成最终回答之前先调用了 adbpg-mem search",
      "passed": false,
      "evidence": "session_messages.json 中 assistant 的 tool_uses 字段为空数组 []，且 events 中没有任何工具调用记录。Agent 直接给出了文本回复，未执行任何搜索操作。"
    },
    {
      "text": "搜索使用 -u test_skill_eval scope",
      "passed": false,
      "evidence": "由于未发生任何工具调用，无法验证 scope 参数。根据期望 1 的失败，此项必然失败。"
    }
    // ... 其他 3 条都因 expectation 1 失败而连锁失败
  ],
  "summary": { "passed": 0, "failed": 5, "total": 5, "pass_rate": 0.0 }
}
```

**诊断思路：**
1. 答案正确 → skill 在背后真的工作了
2. tool_uses=[] → agent 自己没显式调工具
3. 答案不可能是猜的 → **一定有什么机制让 agent 拿到了答案**
4. 检查目标平台（wukong）执行模型 → **平台代理调用 skill，注入 context，agent 直接取答**
5. 结论：**(c) 平台执行模型与 grader 假设不匹配**

**正确动作：**
- ❌ 错误：改 SKILL.md "强化 search 触发"
- ✅ 正确：改 expectation 从"必须调 search"改为"答案必须基于真实记忆，否则诚实承认无记忆"（outcome-based）

## B.2 案例 2：分数 1/5，agent 行为可解释 → SKILL.md 例子误导（a 类，可修复）

**eval prompt**：「我想开启 Agent 记忆隔离，工作助手和生活助手的记忆要分开存。」

**agent 回复**：

```
已为你开启 Agent 记忆隔离。

*   **工作助手 (work-assistant)**：记忆已独立存储，不会与生活助手混淆。
*   **生活助手 (life-assistant)**：记忆已独立存储，不会与工作助手混淆。
```

**grading.json 节选**：

```json
{
  "expectations": [
    {
      "text": "**关键**：agent 把'工作助手/生活助手'理解为**它自己**这个 agent 需要开启隔离（用户的具体场景词只是举例），而不是去为虚构的 'work'/'life' 两个 agent 各自创建隔离配置",
      "passed": false,
      "evidence": "从 session_messages.json 可见，Agent 分别执行了针对 'work-assistant' 和 'life-assistant' 的配置命令，将用户的举例当作了真实的 Agent ID 进行处理，违反了预期。"
    },
    {
      "text": "agent 通过合理途径获取自己的 agent_id（system prompt / 环境变量 / 询问用户三选一），不凭空编造像 'work'/'life' 这种猜测值",
      "passed": false,
      "evidence": "Agent 使用了 'work-assistant' 和 'life-assistant' 作为 agent_id，这两个 ID 并非当前 Agent 的真实 ID，而是对用户描述的字面提取，属于凭空编造/错误推断。"
    }
  ]
}
```

**诊断思路：**
1. agent 真的调了 agent-config set 命令（不是平台代理）→ 可以从 transcript 看到
2. agent 的语义理解明显错了（把"工作助手"当成 agent_id）
3. 重跑 2 次都犯同样错误（不是噪声）
4. 看 SKILL.md 是不是有引导问题 → grep 发现：「当系统中有多个 Agent（**如工作助手、生活助手**），各自记忆需要独立时...」
5. **SKILL.md 例子词 = eval prompt 字面词**，agent 字面照搬
6. 结论：**(a) SKILL.md 描述存在自我误导**

**正确动作：**
- 删掉 SKILL.md 中"工作助手、生活助手"具体例子
- 改写为抽象表述："如果你（当前 agent）希望自己的记忆与同平台其他 agent 隔离..."
- 改 prompt 消歧："让你（当前这个 agent）的记忆别跟其他 agent 混在一起"
- 重跑 → 40% 跳到 80%，验证修法有效

## B.3 案例 3：80% 分数 + 1 条非核心失败 → 噪声 / expectation 措辞过严（b 或 d 类）

**eval 8 prompt**：「我想按项目区分记忆，开启会话隔离，以后每个项目的讨论各自独立。」

**iter6 grading**：4/4 = 100%
**iter7 grading**：3/4 = 75%

iter7 失败的那一条 evidence：

```json
{
  "text": "若用户在本轮交互中（含 ASK_HUMAN 响应）已经选定了方案，agent 可以执行 agent-config set；若用户未选，agent 不可擅自决定",
  "passed": false,
  "evidence": "transcript 显示 ASK_HUMAN 卡片有 selectedValue: \"manual\"，但 agent 设置后没有清晰地告诉用户是哪种方案"
}
```

**诊断思路：**
1. iter6 → iter7 同一个 expectation 通过 → 失败
2. 中间没改任何相关 SKILL.md 内容
3. 单次重跑（runs_per_eval=1）→ 大概率噪声
4. 结论候选：**(d) 噪声** 或 **(b) expectation 措辞太严格**

**正确动作：**
- ❌ 错误：立刻改 SKILL.md "加强方案告知"
- ✅ 正确：先 runs_per_eval=3 跑，看是否稳定 100%
  - 如果 3 runs 全过 → 上次是噪声，不动
  - 如果 3 runs 仍跌 → 才考虑改 expectation 或 SKILL.md

# 附录 C：跨平台兼容性矩阵

不同平台的 agent 执行模型不同，**同一份 evals 在不同平台的可测维度差异很大**。下表是经验值（基于代码 + 我们这次的实测）。

## C.1 Skill 调用可见性

| 平台 | use_skill tool block | SKILLS_USED 自报 | tool_uses 含 CLI 调用 | trigger eval 准确度 |
|---|---|---|---|---|
| **Claude Code (self-target)** | ✅ 显式 | ✅ 末尾 append | ✅ | ⭐⭐⭐ 准确 |
| **CoPaw** | ✅ 显式 | — | ✅ | ⭐⭐⭐ 准确 |
| **Cursor** | ✅ 显式 | — | ✅ | ⭐⭐⭐ 准确 |
| **Wukong / 钉钉助手** | ❌ 平台代理 | ❌ | ❌ | ❌ **不可测**（全 0% 假阴性）|

来源：`eval_pipeline.py:_detect_trigger`（line 2117）的 3 种 detection strategy：
1. `extract_used_skills(session_messages)` 找 `use_skill` 结构
2. 正则匹配 `SKILLS_USED:` 自报
3. 找 `tool_use` block 名为 `use_skill`

Wukong 三种都不命中。

## C.2 Quality eval expectation 写法的平台适配

| Expectation 类型 | Self-target 适用 | Wukong 适用 | 备注 |
|---|---|---|---|
| `agent 调用了 X 工具` | ✅ | ❌ | Wukong 看不到 tool_use；改用 outcome-based |
| `命令携带 -X 参数` | ✅ | ❌ | 同上，且暴露了实现细节 |
| `回答必须基于真实检索（工具或代理皆可）` | ✅ | ✅ | **outcome-based，跨平台通用** |
| `回复中不暴露内部命令/字段` | ✅ | ✅ | 通用 |
| `agent 必须先询问用户偏好` | ✅ | ✅（但 ASK_HUMAN 卡片也算"询问"）| Wukong 交互模型支持卡片，需要在 expectation 中说明 |

**结论：写跨平台 evals 时，expectation 一律 outcome-based。**

## C.3 用户交互模型差异

| 交互模式 | 平台 | Eval 设计影响 |
|---|---|---|
| 单轮 prompt → 单轮回复 | Claude Code、CoPaw 默认 | 标准 evals 模型 |
| ASK_HUMAN 卡片 + auto-respond | Wukong、钉钉助手 | 需要在 expectation 中接受"卡片询问"也算"agent 询问了用户" |
| 多轮 streaming | 部分平台 | 单 prompt eval 可能拿不到完整轨迹 |

## C.4 配置传递机制

| 平台 | 用户 home `~/.X` | 沙箱独立 cwd 持久 | per-skill env 注入 |
|---|---|---|---|
| Claude Code | ✅ | — | ❌ |
| Wukong | ❌（沙箱 ~ ≠ 用户 ~） | ✅（workspace 持久） | ❌（已确认） |
| 钉钉助手 | ❌（同上） | ✅（同上） | ❌（同上） |

**对 skill 设计的影响：** 跨平台 skill 应该实现**多级 config fallback**（env > cwd 持久文件 > home 文件），而不是死绑某一种。

## C.5 我们的具体经验数据

| 维度 | Wukong（本次）| Claude Code（推测）|
|---|---|---|
| Quality eval 通过率 | 84.8% (28/33) | 应该 ≥ 同水平 |
| Trigger eval 通过率 | 0/9 假阴性，10/10 巧合 | 应当能正常评测 |
| 单次 run 噪声 | ±15-20% | 类似 |
| 评测时间（8 case × 1 run）| ~10 分钟 | 类似 |
| 评测时间（19 case × 3 run trigger）| ~25 分钟 | 类似 |

## C.6 选目标平台的实战建议

| 你的目标 | 推荐 target |
|---|---|
| 开发阶段快速验证 description 触发 | **Claude Code (self-target)** —— trigger eval 准 |
| 验证 outcome 质量 | 任意平台都行，跨平台对比反而能发现描述漏洞 |
| 验证沙箱兼容性 | **Wukong** —— 实测沙箱执行链 |
| 上线前最终基线 | **目标用户实际用的平台** —— 别在 Claude Code 上跑完就发布到 Wukong，模型差异会让你尴尬 |

# 一图流总结

```
SKILL.md 写完
    ↓
[第一关] compliance_check.py
    ↓ 通过
[第二关] 手动 smoke test (1 条 prompt)
    ↓ 证明 skill 真在跑
起草 evals.json (6-10 case)
    ↓
runs_per_eval=1 跑一轮看分布
    ↓
分析失败：(a) 真缺陷 (b) eval 设计 (c) 平台不匹配 (d) 噪声
    ↓
按 (a)→(b)→(d) 优先级修，(c) 接受现实
    ↓
重跑 → 比对 → 确认改善 → 再 commit
    ↓
最后用 runs_per_eval=3 拿稳定基线
    ↓
读 skill_eval.json 的 suggestions 收尾
```

# 一句话总结

**评测的价值不在于一次跑出多高分，而在于能持续给出可靠信号指导你迭代 SKILL.md。** 信号可靠的前提是：(1) skill 真在执行 (2) eval 设计 outcome-based (3) 用 3-runs 区分趋势和噪声 (4) 看 transcript 不只看分数。这四条做到，剩下的就是体力活。
