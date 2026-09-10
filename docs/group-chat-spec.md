# 群聊规范（第一阶段提案）

| 项目     | 内容                                                                |
| -------- | ------------------------------------------------------------------- |
| 状态     | 第一阶段规格提案，数据地基、引擎与 server 发言调度已实现            |
| 目标     | 在不破坏现有单聊数据和 Prompt 行为的前提下，支持多角色共享会话      |
| 适用范围 | `packages/engine`、`packages/server`、`packages/web` 的群聊相关实现 |
| 设计基线 | 现有单聊消息状态、SSE 契约、组装计划和“烛下酒馆” UI 规范            |

本文是群聊实现的行为契约。实现前若发现本文与现有 `docs/` 规格冲突，必须先修改规格，不能在代码中隐式拍板。

## 1. 目标与原则

群聊是一个共享聊天历史、包含多个角色参与者的会话。每次生成只允许有一个明确的当前发言角色。

必须满足：

1. 既有单聊会话无需用户迁移或重新创建。
2. 历史消息必须能准确识别具体发言角色。
3. Prompt 组装必须保持 `packages/engine` 的纯函数属性。
4. 单次生成仍然使用现有 `meta → delta → done/error` SSE 生命周期。
5. 同一个会话同时只允许一个生成请求。
6. 群聊功能不得引入新的 UI 组件库或新的运行时依赖。

## 2. 第一阶段范围

### 2.1 实现内容

- 创建群聊并选择至少两个角色卡。
- 查看、增加、移除和排序群聊成员。
- 静音成员；静音成员不参与普通自动选择。
- 手动指定当前发言角色。
- `list` 顺序发言策略。
- `swap` 角色卡模式：每次只把当前发言角色的角色定义放入 Prompt。
- 群聊历史消息保留发言者身份。
- 消息气泡显示角色名。
- 群聊消息的生成、失败、重试、取消、重新生成与单聊保持一致。
- 旧单聊会话自动补齐一个成员记录，行为不变。

### 2.2 明确不在第一阶段实现

- `natural` 自然发言策略。
- `pooled` 轮池策略。
- `join` 合并角色卡模式。
- 自动连续生成多轮对话。
- 群聊分支和书签。
- 角色独立采样参数。
- 角色头像、情绪表情和语音等外围能力。

这些功能可以在第一阶段数据模型中预留字段，但不能以“顺手实现”的方式混入第一阶段。

## 3. 核心术语

| 术语       | 定义                                                 |
| ---------- | ---------------------------------------------------- |
| 群聊会话   | `chat_sessions.kind = group` 的会话                  |
| 成员       | 会话通过 `session_members` 绑定的角色卡              |
| 当前发言者 | 本次生成要扮演的角色                                 |
| 普通生成   | 按当前策略选择发言者后生成一条回复                   |
| 强制发言   | 用户明确指定角色，绕过顺序策略；第一阶段允许绕过静音 |
| Swap 模式  | 只注入当前发言者的角色定义，共享全部聊天历史         |

## 4. 数据模型

### 4.1 `chat_sessions`

保留现有字段，不删除 `character_id`：

| 字段             | 类型   | 语义                                               |
| ---------------- | ------ | -------------------------------------------------- |
| `character_id`   | `text` | 兼容字段；单聊为唯一成员，群聊为创建时的第一名成员 |
| `kind`           | `text` | `single` 或 `group`，默认 `single`                 |
| `group_settings` | `text` | 群聊配置 JSON；单聊为 `null`                       |

`character_id` 在群聊中不是完整成员来源，群聊成员必须以 `session_members` 为准。

### 4.2 `session_members`

```text
session_id       text, FK chat_sessions(id), cascade delete
character_id     text, FK characters(id), cascade delete
position         integer, 非负，越小越靠前
muted            integer, 0/1，默认 0
talkativeness    integer, 0–100，默认 50，第一阶段仅存储不参与选择
created_at       text
PRIMARY KEY (session_id, character_id)
```

第一阶段要求：

- 一个会话中不能重复添加同一角色。
- 群聊至少保留两个成员。
- 成员顺序由 `position` 决定。
- 删除成员后重新压紧 `position`，避免产生不可解释的空洞顺序。

### 4.3 `messages`

新增两个可空字段：

| 字段                   | 语义                                                    |
| ---------------------- | ------------------------------------------------------- |
| `speaker_character_id` | assistant 消息的实际发言角色；user/system 消息为 `null` |
| `speaker_name`         | 发言者名称快照；用于历史显示和 Prompt 身份标注          |

既有消息迁移规则：

- 既有 assistant 消息使用会话的 `character_id` 和当前角色名补齐。
- user/system 消息保持 `null`。
- 不修改现有 `role` 和 `status` 语义。

## 5. 群聊配置

`group_settings` 的规范形态：

```ts
interface GroupSettings {
  replyStrategy: "manual" | "list";
  generationMode: "swap";
  scenarioOverride: string | null;
  allowSelfResponses: boolean;
}
```

第一阶段默认值：

```json
{
  "replyStrategy": "manual",
  "generationMode": "swap",
  "scenarioOverride": null,
  "allowSelfResponses": false
}
```

`allowSelfResponses` 为后续 `natural` 策略预留，第一阶段不改变 `manual/list` 的行为。

未知配置字段必须原样保留，遵循项目对未知字段的宽容保留原则。

## 6. 发言选择

### 6.1 Manual

用户通过 UI 指定角色。普通发送没有默认角色时，使用当前选中的角色；没有当前选择时返回 `speaker_required`，不得静默随机选择。

### 6.2 List

只考虑未静音成员，按 `position` 升序循环：

1. 如果历史中没有 assistant 发言者，选择第一名未静音成员。
2. 否则从上一名 assistant 发言者之后选择下一名未静音成员。
3. 已到列表末尾时回到第一名。
4. 所有成员都静音时返回 `no_available_speaker`。

### 6.3 Force

强制发言显式携带 `speakerId`，只要该角色是会话成员就允许生成，即使它处于静音状态。

### 6.4 纯函数要求

调度器不得访问数据库、网络、时间或 UI。建议接口：

```ts
chooseNextSpeaker(input): {
  characterId: string;
  reason: "manual" | "list" | "force";
}
```

后续加入随机策略时，随机源必须通过参数注入，确保测试确定性。

## 7. Prompt 组装

### 7.1 输入扩展

现有 `AssemblyInput` 增加可选群聊上下文；不传时必须保持单聊输出逐位不变：

```ts
interface GroupAssemblyInput {
  activeCharacterId: string;
  participants: readonly {
    id: string;
    card: CharacterCard;
    muted: boolean;
  }[];
  generationMode: "swap";
  scenarioOverride: string | null;
}
```

`ChatMessage` 增加可选 `speakerId`；现有单聊调用不需要传入。

### 7.2 Swap 规则

每次生成：

- `card` 使用当前发言角色的角色卡。
- 当前角色的名字作为 `{{char}}`。
- 共享历史中保留所有角色消息。
- 当前角色绑定的角色书和全局世界书参与组装；其他成员的角色书第一阶段不自动注入。
- `scenarioOverride` 非空时覆盖当前角色卡的 scenario。

### 7.3 身份标注

为了兼容尽可能多的 OpenAI 兼容上游，第一阶段不依赖 message 对象的额外 `name` 字段。历史消息在送入上游前使用稳定前缀：

```text
Aria: 你终于来了。
Lisa: 这件事恐怕没有那么简单。
User: 我们先调查入口。
```

Prompt 中必须明确：

- 当前模型扮演当前发言角色。
- 带角色名前缀的 assistant 历史是其他角色或当前角色的历史发言。
- 本次只生成当前发言角色的内容。
- 不得替其他角色发言，不得主动生成角色名前缀。

身份指令放在 system 区的 `main` 内容之后、世界书之前。后续如需把它做成可配置槽位，必须同步修改 `docs/prompt-assembly.md` 和组装计划规范。

### 7.4 群聊与单聊兼容

以下输入必须保持现有输出：

- 没有 `group` 输入。
- `chat_sessions.kind = single`。
- 单聊消息没有 `speaker_character_id`。

## 8. HTTP 与 SSE 契约

### 8.1 创建会话

单聊旧格式继续支持：

```json
{ "characterId": "aria", "title": "Aria" }
```

群聊格式：

```json
{
  "kind": "group",
  "title": "旅行者小队",
  "characterIds": ["aria", "lisa", "kaeya"]
}
```

服务端必须校验：

- `characterIds` 是非空字符串数组。
- 群聊至少两个角色。
- 角色都存在。
- 不允许重复角色。

### 8.2 成员管理

```text
GET  /api/sessions/:id/members
PUT  /api/sessions/:id/members
PUT  /api/sessions/:id/group-settings
```

第一阶段可以使用全量替换请求，避免为成员排序、静音、添加、删除设计过多独立端点。提交前服务端必须重新校验成员数量、重复项和角色存在性。

成员全量替换请求形态：

```json
{
  "members": [
    { "characterId": "aria", "muted": false, "talkativeness": 50 },
    { "characterId": "lisa", "muted": true, "talkativeness": 30 }
  ]
}
```

数组顺序即 `position`；`muted` 缺省为 `false`，`talkativeness` 缺省为 `50`。
`group-settings` 接受部分配置对象，未知字段必须和原配置一起保留。

### 8.3 流式生成

单聊请求保持兼容：

```json
{
  "sessionId": "s1",
  "content": "你好"
}
```

群聊请求增加可选 `speakerId`：

```json
{
  "sessionId": "g1",
  "content": "你们怎么看？",
  "speakerId": "aria"
}
```

HTTP 层使用可选 `force` 区分手动选择和强制发言：

- 有 `speakerId` 且 `force` 缺省或为 `false`：使用 `manual`，静音角色会返回 `speaker_muted`。
- 有 `speakerId` 且 `force: true`：使用 `force`，允许选择静音角色。
- 没有 `speakerId`：按 `group_settings.replyStrategy` 使用 `manual` 或 `list`。
- `regenerate` 未指定角色时沿用目标 assistant 消息的发言者。

群聊生成时，`speakerId` 必须属于会话成员。服务端在 `meta` 事件中返回：

```json
{
  "sessionId": "g1",
  "userMessageId": "u1",
  "speakerId": "aria",
  "speakerName": "Aria",
  "tokensTotal": 123
}
```

`delta`、`done`、`error` 事件保持现有格式。`done` 保存 assistant 消息时必须写入 `speaker_character_id` 和 `speaker_name`。

同一会话已有生成任务时返回 HTTP `409`，错误码为 `generation_in_progress`。

## 9. 前端行为

### 9.1 群聊创建

左侧会话区增加“新建群聊”。创建面板必须支持：

- 角色搜索或列表选择。
- 已选成员顺序调整。
- 移除成员。
- 少于两个成员时禁用创建。

### 9.2 聊天页

群聊顶部显示群名和成员状态。每条 assistant 消息显示角色名；生成中显示“`角色名` 正在回复”。

输入区增加当前发言者选择器：

```text
由 Aria 回复 ▼   发送
```

第一阶段不把所有群聊设置塞进顶部，成员静音、顺序和策略放入群聊设置面板。

所有文案必须进入 `packages/web/src/ui-text.ts`，颜色和按钮必须复用现有 `index.css` 令牌与共享类。

## 10. 测试契约

### 10.1 Engine

- 单聊输入输出回归测试。
- manual/list/force 调度测试。
- 静音、全静音和无历史发言者测试。
- Swap 只使用当前角色卡测试。
- 多角色历史身份前缀测试。
- scenario override 测试。
- 群聊 token 裁剪和预算错误测试。

### 10.2 Server

- 群聊创建、重复角色、缺失角色和成员数量校验。
- 旧数据库迁移与旧单聊回归。
- 成员排序、静音和设置持久化。
- speaker 校验和消息 speaker 字段落库。
- 上游请求中的群聊身份标注。
- SSE 成功、失败、重试、取消和并发 409。

### 10.3 Web

- 群聊详情载入。
- speakerId 随生成请求发送。
- 当前生成角色显示与状态清理。
- 切换会话不串 streaming 状态。
- 成员管理失败时保留本地表单状态。

### 10.4 验收场景

1. 创建三个角色的群聊。
2. 调整顺序并静音一个角色。
3. 指定角色生成一条回复。
4. 切换到另一个角色继续生成。
5. 刷新页面后确认成员、消息身份和顺序不丢失。
6. 让上游返回错误，确认只标记当前用户消息为 `failed`。
7. 重试后确认不产生重复用户消息。
8. 同时发起两个请求，确认第二个返回 `generation_in_progress`。

## 11. 实施顺序

1. 迁移 schema，并补充旧数据回填测试。
2. 扩展 engine 的群聊类型、身份格式化和 Swap 组装。
3. 实现 engine 的 manual/list/force 调度器。
4. 扩展 server 会话、成员和群聊设置 API。
5. 扩展 chat stream 与消息落库。
6. 扩展 web API、Zustand store 和消息组件。
7. 实现群聊创建面板、成员面板和 speaker 选择器。
8. 补齐测试、README 和截图。

## 12. 非目标与风险

- 不复制或移植 SillyTavern 源码；只参考公开行为和文件格式。
- 不在 server 层复制 Prompt 引擎逻辑。
- 不把所有角色卡全文同时塞进 Prompt；第一阶段默认 Swap，避免 token 成本和人格混淆失控。
- 不在第一阶段实现自动多轮，避免客户端刷新、取消和并发状态复杂化。
- 如果后续需要 `join` 模式，必须重新评估 system 段顺序、token 预算和角色身份冲突。
