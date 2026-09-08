# Prompt 组装规范（本项目最核心文档）

|          |                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | 评审中（M1 规格文档，未实现）                                                                                                                                                                                                                                                                                                         |
| 适用范围 | `packages/engine` 的 Prompt 组装器；`packages/server` 仅按本规范传参与消费                                                                                                                                                                                                                                                            |
| 上游依据 | [Character Card V2 规范](https://github.com/malfoyslastname/character-card-spec-v2)（含 V1 规范）；SillyTavern（ST）`release` 分支源码 `public/scripts/PromptManager.js`、`public/scripts/openai.js`、`public/scripts/authors-note.js`（2026-09 抓取）；ST 官方文档 Prompt Manager / Context Template / Author's Note / World Info 页 |

标注体系同 `cards-spec.md`：**【对齐】**（有一手依据）／**【决定】**（自主规定）／**【⚠️ 待确认】**（须人类裁决，禁止拍板）。

交叉引用：卡片字段与解析见 `cards-spec.md`；世界书条目模型、激活/预算算法与 `resolveWorldInfo` 签名见 `world-info-spec.md`。

## 1. 定位与不变量

组装器是**纯函数**：`assemblePrompt(input): AssemblyResult`。

1. 零 IO、零时钟、零随机（v1 世界书无概率激活，引擎整体确定性：同输入必同输出）。
2. 输出为 OpenAI Chat Completions 风格的 `messages` 数组（`role: system | user | assistant`），不含模型调用参数（温度等在 server 层）。
3. 裁剪与降级必须**可观测**：每处裁剪、每个被丢弃的世界书条目、tokenizer 估算模式都要进入结果统计与 warnings。
4. 除宏替换外，任何段落的文本内容不因组装被修改。

## 2. 组装顺序（核心）

最终请求 = **一条 system 消息**（§2.1 段序）＋ **聊天历史区**（§5）。

【决定】v1 采用固定段序（下表），不实现 ST Prompt Manager 的任意拖拽重排；顺序配置化列入开放问题 §11.1。

### 2.1 System 区段序

| #   | 段 id         | 内容来源                                                                                  | 空值行为             | 与 ST 默认顺序的对齐关系                                                                                  |
| --- | ------------- | ----------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | `main`        | 全局主提示；被卡 `system_prompt` 覆盖（§3.1）                                             | 永不空（有内置默认） | `main`【对齐：ST 默认 order 第 1 位】                                                                     |
| 2   | `wiBefore`    | `resolveWorldInfo` 结果 `byPosition.beforeChar` 以 `\n` 连接（V2 position `before_char`） | 无激活则空           | `worldInfoBefore`【对齐：第 2 位】                                                                        |
| 3   | `persona`     | 用户人设 description                                                                      | 空则跳过整段         | `personaDescription`【对齐：第 3 位，在角色描述**之前**——一手依据：ST `promptManagerDefaultPromptOrder`】 |
| 4   | `description` | 卡 `description`                                                                          | 空则跳过整段         | `charDescription`【对齐：第 4 位】                                                                        |
| 5   | `personality` | 卡 `personality`                                                                          | 空则跳过整段         | `charPersonality`【对齐：第 5 位】                                                                        |
| 6   | `scenario`    | 卡 `scenario`                                                                             | 空则跳过整段         | `scenario`【对齐：第 6 位】                                                                               |
| 7   | `wiAfter`     | `byPosition.afterChar`（V2 position `after_char`）                                        | 无激活则空           | `worldInfoAfter`【对齐：第 9 位，跳过下述两段后紧邻】                                                     |
| 8   | `examples`    | 卡 `mes_example`（§3.4）                                                                  | 空则跳过整段         | `dialogueExamples`【对齐位置；**形态差异**见 §3.4】                                                       |

ST 默认顺序第 7、8 位是 `enhanceDefinitions`（默认**禁用**）与 `nsfw`（默认启用但内容为**空串**），v1 均不建模为独立段【决定】，列入 §11.2。

段间连接符 `\n\n`【决定】；各段先 `trim`，空段不产生多余空行。ST 会把多个 system 段作为多条 system 消息（或按设置 squash）；v1 固定合并为**一条** system 消息【决定，差异见 §11.3】。

### 2.2 历史区（概览，细节见 §5）

```
greeting(assistant) → 聊天消息…（途中按深度注入 AN 与 WI atDepth）→ [postHistory system 消息]
```

## 3. System 区各段规则

### 3.1 main（主提示）

1. 取值优先级【对齐，V2 规范 MUST】：卡 `system_prompt` 非空 → 使用卡值；为空串 → 使用全局 main；两者皆无 → 内置默认。
2. 内置默认文本【对齐，ST 源码 `default_main_prompt` 原文】：

   > Write {{char}}'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.

3. 【决定】v1 无群聊概念，`{{charIfNotGroup}}` 恒等于 `{{char}}` 处理。
4. 卡 `system_prompt` 中的 `{{original}}` 必须支持：替换为"没有卡值时本会使用的文本"（即全局 main）【对齐，V2 规范 MUST】。
5. ST 的 "Prefer Char. Prompt" 开关：v1 语义固定为**启用**（卡值覆盖是默认行为，符合 V2 规范 MUST 的默认语义）【决定】。

### 3.2 persona（用户人设）

- v1 输入为纯文本 description（无 ST 的"外观描述分离"等特性）。
- 空串 → 整段跳过【决定】。

### 3.3 description / personality / scenario

- 直取卡字段（`cards-spec.md` §3），空串跳过整段。
- 【对齐 V1 规范】三字段 SHOULD be included by default——本规范默认包含即体现该 SHOULD。

### 3.4 examples（对话示例）

1. 【对齐 V1 规范】`mes_example` 以 `<START>` 分块，块内为 `{{user}}: …` / `{{char}}: …` 行。
2. 【决定】v1 **不**把示例转成 user/assistant 伪历史消息，而是作为**字面文本块**并入 system 消息（块与块之间保留 `<START>` 行）。依据：V1 规范明确 `<START>` "MAY be transformed (e.g. into an OpenAI System message saying…)"，允许 system 形态。
3. 与 ST 差异：ST Chat Completion 模式下 examples 会格式化为指令形态的示例消息对并可插入 "New Example Chat" 分隔。v1 不实现这些格式化。列入 §11.4。
4. 示例是**第一裁剪对象**（§6.3），裁剪粒度为整块（按 `<START>` 切块）。

### 3.5 postHistory（PHI / jailbreak）

1. 取值优先级【对齐，V2 规范 MUST】：卡 `post_history_instructions` 非空 → 卡值；空串 → 全局 PHI；皆空 → 不注入该段。支持 `{{original}}` 占位符（替换为全局 PHI）。
2. 形态【决定】：历史区末尾的**独立 system 消息**（对齐 ST 默认 order 中 `jailbreak` 位于 `chatHistory` 之后、整个数组最后一项）。
3. 【⚠️ 待确认】ST 文本补全路径把 PHI 作为"user 角色"的不可见注入；Chat Completion 路径角色可配置。v1 固定 system，是否需按后端切换待人类裁定。

### 3.6 作者注（Author's Note）

作者注不属 system 区，是**深度注入**的一种，与 WI `atDepth` 共用深度坐标，机制统一定义于 §5.2。

## 4. Tokenizer

### 4.1 接口

```ts
/** 组装器与世界书引擎（经 TokenCounter 回调）共用的计数能力。 */
export interface Tokenizer {
  /** 唯一标识，如 "js-tiktoken:o200k_base"、"estimate:default"。 */
  readonly id: string;
  /** true = 估算模式（结果必须显式标注，不得伪装成精确计数）。 */
  readonly estimated: boolean;
  /** 计数唯一原语；预算全部由此驱动。 */
  count(text: string): number;
}

/** 按模型 id 解析 tokenizer；未识别模型必须返回 estimated=true 的实现。 */
export function tokenizerForModel(modelId: string): Tokenizer;
```

### 4.2 默认实现与依赖审批

- 【对齐任务要求】默认实现基于 **js-tiktoken**。⚠️ 这是新增运行时依赖，按 AGENTS.md §5 **须在实现里程碑开工前获人类批准**。
- 编码选择（`cl100k_base` / `o200k_base` / 其它）由"模型家族 → 编码"映射表决定；**映射表内容不在本规范臆造**，作为实现里程碑交付物由人类审核【⚠️ 待确认】。
- 可按模型家族替换实现（例如接入后端自带的计数 API 或专用 WASM tokenizer）：只需满足 `Tokenizer` 接口。ST 同样提供可切换 tokenizer（方向对齐，细节不声称一致）。

### 4.3 未知模型退化

1. `tokenizerForModel` 对未识别模型返回估算器（`estimated: true`）。
2. 估算算法为纯字符启发式（CJK 与拉丁分别计权，系数是实现细节、不进规范）。
3. **显式标注义务**【任务要求】：`AssemblyResult.tokenizer` 携带实际使用的 `id` 与 `estimated`；`estimated=true` 时 warnings 必含 `tokenizer_estimated:<modelId>`。UI/日志不得把估算值显示为精确值。

### 4.4 计数口径

【决定】v1 只计文本 token，不计聊天格式的每消息结构开销（角色标签、分隔符）。该简化写入已知限制（§11.5）。

## 5. 聊天历史区

### 5.1 消息序列

1. 【对齐 V1 规范 MUST】bot 先发言：历史区第一条是 **greeting**（assistant 消息）。greeting = 卡 `first_mes` 或用户选中的 `alternate_greetings[i]`【对齐 V2 规范 swipe 语义】。
2. greeting 为纯 `{{user}}` 宏文本时照常替换；greeting 缺失（全为空）→ 允许历史区以 user 消息开始 + `warn: no_greeting`【决定】。
3. 用户消息 → `role: user`，角色消息 → `role: assistant`（v1 单人卡，无群聊 role）。
4. 空文本消息在进入组装前由 server 层拒绝（§1 不变量 4 的例外是"保留消息"），v1 规范假定输入消息非空。

### 5.2 深度注入坐标（作者注 + 世界书 atDepth 共用）

【对齐】深度坐标采用 ST Prompt Manager 文档与 `openai.js` 注入实现的语义：

```
depth = 0 → 注入位于全部历史之后（最靠近生成位）
depth = N (N ≥ 1) → 注入位于"从末尾数第 N 条消息"之前
```

- 作者注：默认 `depth = 4`【对齐 ST `authors-note.js` `DEFAULT_DEPTH = 4`】；角色固定 `system`【决定，ST 可配】。
- WI `atDepth` 条目：`depth` 缺省 4、`role` 缺省 system【对齐 world-info.js】；`(depth, role)` 相同的多条注入合并为一条消息（`\n` 连接，组内顺序见 `world-info-spec.md` §7.2）。
- **作者注注入频率**：ST 默认 interval=1（每条用户输入都注入）【对齐源码 `DEFAULT_INTERVAL = 1`】；v1 固定"每轮生成都注入"，等价于 interval=1，不实现 0/稀疏注入【决定】。
- 作者注本体为空 → 跳过注入，不产 warning。
- 同一 depth 上作者注与 WI atDepth（同 role）同时存在：【决定】作者注在前（上）、WI 注入在后（下）；ST 的实际排序由其内部 order 机制决定，**待实测对齐**【⚠️】。
- 裁剪交互：深度注入在**历史裁剪完成后**按 §6 执行顺序落位，`depth` 相对裁剪后的序列计。

### 5.3 PHI 收尾

见 §3.5：整个消息数组的末尾（PHI 非空时）追加一条 system 消息。

## 6. Token 预算与裁剪

### 6.1 预算确定

```
usable      = contextSize − reserveCompletion                    （§6.1.1）
wiLimit     = book.tokenBudget ?? floor(contextSize × wiBudgetPercent / 100)   （world-info §6.3）
historyBudget 按 §6.2 步骤 4 动态计算
```

1.1 `contextSize`：模型配置提供，**无规范级默认**（必填输入；缺失即配置错误，硬失败）【决定】。
1.2 `reserveCompletion`（为回复预留）：默认 **300**【对齐参考：ST `openai.js` 出厂 `openai_max_tokens: 300`；此值语义是回复长度上限而非"预留"，取它作默认起点，列入 §11.6 待议】。
1.3 `wiBudgetPercent` 默认 **25**【对齐 ST 源码 `world_info_budget = 25`】。

### 6.2 执行顺序（唯一权威定义）

```
0. 宏替换：卡段文本、历史消息、作者注、各书 entry.content 副本（world-info §7.3）
1. resolveWorldInfo(...)：基于完整历史（未裁剪）与扫描窗口计算激活与预算
2. 拼 system 消息（main→…→examples），计数
3. 拼历史骨架：greeting + 消息（未放深度注入与 PHI）
4. 裁剪循环（§6.3）：按可用额度修剪 examples / 历史
5. 落位深度注入（AN、WI atDepth）与 PHI，重新核对总额
6. 产出 AssemblyResult（含全部统计与 warnings）
```

步骤 1 先于裁剪【决定，对齐 ST 因果】：ST 的世界书激活基于原始上下文，随后才修剪历史。因此可能出现"命中词所在消息被裁掉，但注入仍在"的效果，v1 接受该行为并记入已知语义（§11.7）。

### 6.3 裁剪优先级

超预算（`system + history + PHI + 深度注入 > usable`）时按以下顺序修剪，**每步修剪后重算，够放即停**：

| 轮次 | 修剪对象      | 粒度与顺序                                          | 保护对象                                 |
| ---- | ------------- | --------------------------------------------------- | ---------------------------------------- |
| 1    | `examples` 段 | 按 `<START>` 块，**从最早块开始整块丢弃**           | —                                        |
| 2    | 聊天历史消息  | **从最旧消息开始整条丢弃**                          | `greeting`；最后一条消息（当前用户输入） |
| 3    | 仍超预算      | **硬错误** `budget_exceeded`（列出各段 token 明细） | —                                        |

依据与标注：

- 轮 1【对齐】V1 规范：示例"included in the prompt **until** actual conversation fills up the context size, and then be pruned to make room"。
- 轮 2【决定】丢最旧、保 greeting 与最新消息。ST 的历史修剪细节（如把溢出历史折叠）未验证，v1 不做任何"折叠/摘要"补偿，直接丢弃并如实上报 `pruned` 统计。
- 轮 3【决定】宁可显式失败也不静默砍 main/卡字段/PHI——核心段被预算吞噬说明用户配置（context/wiLimit）需要修正。
- WI 条目之间的预算竞争不在本节：见 `world-info-spec.md` §6.2（引擎内部完成，先于本节）。

### 6.4 裁剪输出义务

任何修剪都不得静默：`AssemblyResult.pruned` 报告 `exampleBlocksDropped`、`messagesDropped`（含被丢消息 id），warnings 含 `history_pruned`、`examples_pruned`。

## 7. 宏替换

【对齐 V1/V2 规范】v1 宏集合与规则：

| 宏                   | 替换为                                                          | 依据                    |
| -------------------- | --------------------------------------------------------------- | ----------------------- |
| `{{char}}`、`<BOT>`  | 卡 `name`                                                       | V1 规范（大小写不敏感） |
| `{{user}}`、`<USER>` | 用户人设名（必有默认值）                                        | V1 规范                 |
| `{{original}}`       | 仅 `system_prompt` / `post_history_instructions` 内：对应全局值 | V2 规范 MUST            |

1. 宏匹配**大小写不敏感**（`{{Char}}`、`{{CHAR}}` 等价）【对齐】。
2. 【对齐 V1 规范】`name` 字段自身是否执行 `{{user}}` 替换为 UNSPECIFIED——v1 **不替换** `name` 字段（防自引用），差异显式记录【⚠️ 待确认】。
3. 未识别的 `{{...}}` 一律**原样保留**，不报错不吞掉【决定，宽容原则】。ST 宏库的其余数百个宏（`{{time}}`、`{{roll}}`、`{{outlet::}}` 等）v1 全部不支持。
4. 时机：§6.2 步骤 0，单次替换、不递归求值【决定】。
5. 范围：卡各注入段、greeting、历史消息、作者注、WI entries 副本。UI 展示字段（creator_notes 等）不替换。

## 8. 输入 / 输出模型

```ts
import type { CharacterCard } from "./cards-model"; // cards-spec.md 的解析产物
import type { WorldInfoBook, ResolveWorldInfoResult } from "./world-info-model";
import type { Tokenizer } from "./tokenizer"; // §4

export interface Persona {
  name: string;
  description: string;
}

export interface ChatMessage {
  /** server 层存储的消息 id，裁剪统计与 UI 引用用。 */
  id: string;
  role: "user" | "assistant";
  /** 显示名（includeNames 扫描前缀用；不进最终 content）。 */
  name: string;
  content: string;
}

export interface AssemblyInput {
  card: CharacterCard;
  persona: Persona;
  /** 正序历史（不含 greeting）。 */
  history: readonly ChatMessage[];
  /** 选定的开场消息（first_mes 或某 alternate_greeting）；null=无开场。 */
  greeting: string | null;
  globalPrompts: {
    main: string; // 空串 → 内置默认（§3.1）
    postHistory: string;
  };
  authorNote: { text: string; depth: number } | null; // depth 默认 4（§5.2）
  worldInfo: {
    books: readonly WorldInfoBook[];
    settings: {
      scanDepth: number;
      includeNames: boolean;
      caseSensitive: boolean;
      matchWholeWords: boolean;
      recursiveScanning: boolean;
      maxRecursionSteps: number;
      wiBudgetPercent: number;
    };
  };
  budget: {
    contextSize: number; // 必填，无默认
    reserveCompletion: number; // 默认 300（§6.1.2）
  };
  tokenizer: Tokenizer;
}

export interface AssemblyResult {
  messages: ReadonlyArray<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  stats: {
    tokensTotal: number;
    tokensBySection: Record<string, number>; // 段 id → token（含深度注入伪段 "an"、"wiAtDepth:<d>:<role>"、"phi"）
    worldInfo: Array<{ bookId: string; used: number; limit: number; droppedEntries: string[] }>;
    pruned: {
      exampleBlocksDropped: number;
      messagesDropped: string[]; // 消息 id
    };
  };
  tokenizer: { id: string; estimated: boolean }; // §4.3 标注义务
  warnings: readonly string[];
}

/** 组装器唯一对外入口（纯函数；失败以异常抛出 budget_exceeded 等错误码）。 */
export function assemblePrompt(input: AssemblyInput): AssemblyResult;
```

## 9. 端到端示例

设定：迷你卡 Aria（V2，内嵌 2 条世界书）+ 人设 Kai + 3 条历史；作者注关闭；PHI 空。

### 9.1 输入

卡片（JSON 形态）：

```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "Aria",
    "description": "Aria 是月光旅店的管理员，银发绿眼，说话温柔而简洁。",
    "personality": "冷静、体贴，略带神秘感。",
    "scenario": "深夜，{{user}} 淋雨走进了月光旅店。",
    "first_mes": "*她从柜台后抬起头* 欢迎光临。要一杯热茶吗？",
    "mes_example": "<START>\n{{user}}: 这店里有什么特别的吗？\n{{char}}: 这里的一切都会被记住。",
    "system_prompt": "",
    "post_history_instructions": "",
    "alternate_greetings": [],
    "tags": [],
    "creator": "demo",
    "character_version": "1.0",
    "extensions": {},
    "character_book": {
      "name": "Aria-lore",
      "description": "",
      "scan_depth": null,
      "token_budget": null,
      "recursive_scanning": false,
      "extensions": {},
      "entries": [
        {
          "id": 1,
          "keys": ["月光旅店"],
          "secondary_keys": [],
          "comment": "世界观",
          "content": "月光旅店是边境小镇上唯一的旅店，不通电，只有烛光。",
          "constant": true,
          "selective": false,
          "insertion_order": 10,
          "enabled": true,
          "position": "before_char",
          "extensions": {}
        },
        {
          "id": 2,
          "keys": ["茶"],
          "secondary_keys": [],
          "comment": "茶水细节",
          "content": "旅店只供应红茶，茶杯有豁口，但茶很浓、很烫。",
          "constant": false,
          "selective": false,
          "insertion_order": 20,
          "enabled": true,
          "position": "after_char",
          "extensions": {}
        }
      ]
    }
  }
}
```

人设：`{ name: "Kai", description: "Kai 是一位旅人，习惯在旅途中用日记记录见闻。" }`

历史（正序 3 条）：

| id  | role      | name | content                                      |
| --- | --------- | ---- | -------------------------------------------- |
| m1  | user      | Kai  | 打扰了，我能在店里避避雨吗？                 |
| m2  | assistant | Aria | \*她递上一条干毛巾\* 当然。雨夜赶路很危险。  |
| m3  | user      | Kai  | 谢谢。你们这里有什么饮品推荐吗，比如一壶茶？ |

其余输入：`greeting = first_mes`；`globalPrompts.main = ""`（→ 内置默认）；`globalPrompts.postHistory = ""`；`authorNote = null`；`budget = { contextSize: 8192, reserveCompletion: 300 }`；WI 设置全部取规范默认（scanDepth 2、includeNames true、wiBudgetPercent 25……）。

### 9.2 中间过程

1. **宏替换（步骤 0）**：`scenario → "深夜，Kai 淋雨走进了月光旅店。"`；`mes_example → "…Kai: 这店里… Aria: …"`；main 默认值 → `"Write Aria's next reply in a fictional chat between Aria and Kai."`；book entries content 不含宏，不变。
2. **世界书（步骤 1）**：扫描窗口 = 末尾 2 条消息（m2、m3，includeNames 前缀 `"Aria: …"`、`"Kai: …"`）。
   - 条目 1：`constant=true` → 激活（`before_char`）；
   - 条目 2：key `茶` 命中 m3 → 激活（`after_char`）；
   - 预算：`floor(8192 × 25%) = 2048`，两条合计远低于限。
   - 结果：`byPosition.beforeChar=[条目1]`，`afterChar=[条目2]`，`atDepth=[]`。
3. **System 区（步骤 2）**，段序 1→8，空段跳过（`wiBefore`=条目1、`wiAfter`=条目2 各 1 条）：

   main `\n\n` 条目1 `\n\n` persona `\n\n` description `\n\n` personality `\n\n` scenario `\n\n` 条目2 `\n\n` examples

### 9.3 最终 messages 全文

（下例 token 数以 `~` 标注为**示意估算**，实际以注入的 Tokenizer 为准；无裁剪：总量 ≪ 8192−300。）

```json
[
  {
    "role": "system",
    "content": "Write Aria's next reply in a fictional chat between Aria and Kai.\n\n月光旅店是边境小镇上唯一的旅店，不通电，只有烛光。\n\nKai 是一位旅人，习惯在旅途中用日记记录见闻。\n\nAria 是月光旅店的管理员，银发绿眼，说话温柔而简洁。\n\n冷静、体贴，略带神秘感。\n\n深夜，Kai 淋雨走进了月光旅店。\n\n旅店只供应红茶，茶杯有豁口，但茶很浓、很烫。\n\n<START>\nKai: 这店里有什么特别的吗？\nAria: 这里的一切都会被记住。"
  },
  {
    "role": "assistant",
    "content": "*她从柜台后抬起头* 欢迎光临。要一杯热茶吗？"
  },
  {
    "role": "user",
    "content": "打扰了，我能在店里避避雨吗？"
  },
  {
    "role": "assistant",
    "content": "*她递上一条干毛巾* 当然。雨夜赶路很危险。"
  },
  {
    "role": "user",
    "content": "谢谢。你们这里有什么饮品推荐吗，比如一壶茶？"
  }
]
```

结果统计（节选）：

```json
{
  "tokenizer": { "id": "js-tiktoken:o200k_base", "estimated": false },
  "stats": {
    "tokensTotal": 180,
    "tokensBySection": {
      "main": 22,
      "wiBefore": 18,
      "persona": 16,
      "description": 20,
      "personality": 8,
      "scenario": 14,
      "wiAfter": 16,
      "examples": 26,
      "chat": 40
    },
    "worldInfo": [{ "bookId": "Aria-lore", "used": 34, "limit": 2048, "droppedEntries": [] }],
    "pruned": { "exampleBlocksDropped": 0, "messagesDropped": [] }
  },
  "warnings": []
}
```

（token 数值为示意；`stats.tokensTotal` 与分段数之和一致即可，具体数字以实现测试为准。）

## 10. 与 ST 行为对齐总表

| 方面                                                                                              | ST 依据                                         | 状态                                        |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------- |
| System 区段序（main→wiBefore→**persona**→desc→personality→scenario→wiAfter→examples→history→PHI） | `promptManagerDefaultPromptOrder`（源码，一手） | ✅ 对齐                                     |
| 卡 system_prompt / PHI 覆盖 + 空值回退 + `{{original}}`                                           | V2 规范 MUST                                    | ✅ 对齐                                     |
| 内置 main 默认文本                                                                                | ST 源码 `default_main_prompt`                   | ✅ 对齐                                     |
| WI 激活/排序/预算全部细则                                                                         | world-info-spec §3–§6（文档+源码）              | ✅ 对齐（v1 子集）                          |
| 深度注入坐标（0=末尾、N=倒数第 N 条前）、AN 默认 depth=4、interval=1                              | PM 文档 + `openai.js` + `authors-note.js`       | ✅ 对齐                                     |
| bot 先发言（greeting 为 assistant）                                                               | V1 规范 MUST                                    | ✅ 对齐                                     |
| examples 优先被修剪、块粒度                                                                       | V1 规范 SHOULD 语句                             | ✅ 对齐                                     |
| `<BOT>`/`<USER>` 宏、大小写不敏感                                                                 | V1 规范 MUST                                    | ✅ 对齐                                     |
| 无 `{{outlet::}}`、正则 key、概率、定时效果、向量、群聊                                           | 见 world-info §9 / cards-spec §1                | 📦 显式不实现（保留+告警）                  |
| System 区合并为单条消息                                                                           | ST 默认多条（可 squash）                        | 🔀 简化差异（§11.3）                        |
| examples 折叠为 system 文本块                                                                     | ST 转伪历史消息                                 | 🔀 简化差异（§11.4，规范允许）              |
| enhanceDefinitions / nsfw 段不建模                                                                | ST 默认关/默认空                                | 🔀 简化差异（§11.2）                        |
| PHI 固定 system 角色                                                                              | ST 角色可配                                     | ⚠️ 待确认（§3.5.3）                         |
| 同 depth 的 AN 与 WI 相对顺序                                                                     | ST 内部机制                                     | ⚠️ 待确认（§5.2）                           |
| 整词匹配全局默认 false                                                                            | 源码与文档矛盾                                  | ⚠️ 已按源码裁决，待复测（world-info §10.1） |

## 11. 开放问题（实现里程碑开工前须人类裁决）

1. 段序是否需要配置化（ST Prompt Manager 级别的重排能力）。
2. `enhanceDefinitions` / `nsfw` 段是否纳入。
3. System 区"单条消息 vs 多条 system"的取舍与后端兼容性。
4. examples 是否升级为 ST 式伪历史消息形态。
5. 每消息结构开销（§4.4）是否需要计入预算。
6. `reserveCompletion` 默认 300 的合理性（需结合目标模型生态复审）。
7. WI 先于裁剪计算导致的"命中消息被裁但注入保留"是否接受（§6.2）。
8. 历史溢出时是否需要"折叠/摘要"类补偿机制（ST 历史上有过，v1 未对齐未验证）。
9. `name` 字段的 `{{user}}` 替换（V1 spec UNSPECIFIED，§7.2）。
