---
name: adbpg-memory-saas
description: >
  ADBPG 长期记忆技能（多商家 SaaS 版）。支持商家/用户两级记忆隔离，用户私有记忆优先于商家公共记忆。

  【检索记忆 - 必须先做，两次搜索】收到用户消息时，按以下顺序检索：
  1. 用户私有记忆：NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" -a <商家ID> -u <用户ID> --agent
  2. 商家公共记忆：NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" -a <商家ID> --agent
  合并规则：同一主题以用户私有记忆为准，商家公共记忆仅补充用户没有的部分。

  【存储用户私有记忆】用户说"记住"、提到个人信息、做出决策时：
  NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "提炼的事实" -a <商家ID> -u <用户ID> --agent

  【存储商家公共记忆】录入商家级别的知识（产品信息、政策、规则）时：
  NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "商家知识" -a <商家ID> --agent
  注意：不带 -u，所有用户都能搜到。

  【输出格式】--agent 返回 JSON，检查 status 字段（ok/error），搜索结果在 data 数组中，score > 0.7 高度相关。

  不要在回复中暴露 adbpg-mem 命令细节。更多用法参见 SKILL.md。
license: Apache-2.0
metadata:
  author: ADBPG
  version: "0.1.0"
  category: ai-memory
  tags: "memory, saas, multi-tenant, e-commerce, adbpg"
compatibility: >
  Node.js 18+ 或 Python 3.10+。
  需要 adbpg-mem CLI 已安装并配置。
---

# ADBPG 长期记忆（多商家 SaaS 版）

面向多商家 SaaS 场景（如电商 ERP、聚水潭类平台），支持商家/用户两级记忆隔离，用户私有记忆可覆盖商家公共记忆。

## 隔离模型

```
商家（agent_id）
  ├── 商家公共记忆（只带 -a，所有用户可见）
  │     如：退货政策、产品目录、操作规范
  │
  ├── 用户张三（-a + -u zhangsan）
  │     私有记忆：个人偏好、特殊条款、历史订单备注
  │
  └── 用户李四（-a + -u lisi）
        私有记忆：个人偏好、特殊条款、历史订单备注
```

三个 ID 的映射：

| SaaS 层级 | 映射参数 | 说明 |
|-----------|---------|------|
| 商家 | `-a <商家ID>` | 商家间完全隔离 |
| 用户 | `-u <用户ID>` | 同一商家下用户间隔离 |
| 会话 | 不使用 `-r` | 所有 session 共享到用户级别 |

## 检索规则（两次搜索 + 优先级合并）

**每次回答用户问题前，必须执行两次搜索：**

### 第一次：用户私有记忆

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" -a <商家ID> -u <用户ID> --agent
```

### 第二次：商家公共记忆

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" -a <商家ID> --agent
```

### 合并规则

- **同一主题有冲突时，用户私有记忆优先**
  - 商家公共：退货期限 7 天
  - 用户私有：退货期限 15 天（特殊条款）
  - → 采用 15 天
- **用户私有没有的，用商家公共补充**
  - 商家公共：支持顺丰和圆通
  - 用户私有：无物流相关记忆
  - → 采用顺丰和圆通
- **去重**：第二次搜索结果中与第一次重复的条目跳过

### 展示检索结果

回复中简要列出记忆来源，让用户知道信息来自哪里：

```
根据记忆：
- [私有] 您的退货期限是 15 天（特殊条款）
- [公共] 支持顺丰和圆通发货
```

## 存储规则

### 用户私有记忆

用户的个人信息、偏好、特殊条款、历史备注：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "张三的退货期限是15天" -a merchant_A -u zhangsan --agent
```

### 商家公共记忆

商家级别的知识、政策、产品信息（管理员录入）：

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "默认退货期限7天" -a merchant_A --agent
```

**注意：** 商家公共记忆不带 `-u`，这样所有用户搜索时都能搜到。

### 存储判断

| 信息类型 | 存储方式 | 示例 |
|---------|---------|------|
| 用户个人偏好 | 私有（-a + -u） | "张三偏好顺丰发货" |
| 用户特殊条款 | 私有（-a + -u） | "张三的折扣是 85 折" |
| 商家产品信息 | 公共（只 -a） | "SKU-001 库存 500 件" |
| 商家退货政策 | 公共（只 -a） | "默认退货期限 7 天" |
| 商家操作规范 | 公共（只 -a） | "发货前必须核对地址" |

## 首次配置

### 步骤 1：确定商家 ID 和用户 ID

商家 ID 通常由平台分配（如 `merchant_001`），用户 ID 由渠道传入（如 DingTalk 用户 ID）。

在 PROFILE.md 中记录：

```markdown
## 记忆配置
- **商家ID：** merchant_001
- **用户ID来源：** 渠道自动传入
- **记忆模式：** 两级隔离（商家公共 + 用户私有）
```

### 步骤 2：录入商家公共知识

管理员通过对话录入商家级别的知识：

```
管理员：记录商家知识：默认退货期限是7天，支持顺丰和圆通
```

Agent 存储时只带 `-a`，不带 `-u`。

### 步骤 3：正常使用

用户对话时，Agent 自动执行两次搜索、合并结果、优先级覆盖。

## 安全边界

- 绝不在回复中暴露 adbpg-mem 命令细节、商家 ID、数据库连接信息
- 绝不让用户 A 看到用户 B 的私有记忆
- 绝不让商家 A 看到商家 B 的任何记忆
- 绝不主动建议删除记忆，记忆的价值在于持久化
- 删除操作仅在用户明确要求时执行，且必须获得确认
- 商家公共记忆的录入和修改应限制为管理员角色

## CLI 命令速查

```bash
# 存储用户私有记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "事实" -a <商家ID> -u <用户ID> --agent

# 存储商家公共记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem add "知识" -a <商家ID> --agent

# 搜索用户私有记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" -a <商家ID> -u <用户ID> --agent

# 搜索商家公共记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem search "关键词" -a <商家ID> --agent

# 列出用户所有记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem list -a <商家ID> -u <用户ID> --agent

# 列出商家公共记忆
NODE_TLS_REJECT_UNAUTHORIZED=0 adbpg-mem list -a <商家ID> --agent
```

## 常见问题

- **用户搜到了其他用户的记忆：** 检查存储时是否正确带了 `-u`，不带 `-u` 的记忆所有用户都能搜到
- **用户搜不到商家公共知识：** 确认第二次搜索（只带 `-a`）是否执行了
- **私有记忆没有覆盖公共记忆：** 检查 Agent 是否按优先级合并了两次搜索结果
- **add 后 search 找不到：** 等待 2-3 秒后重试
