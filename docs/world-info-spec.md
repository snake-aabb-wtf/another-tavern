# 世界书引擎规范（World Info / Lorebook）

|          |                                                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态     | 评审中（M1 规格文档，未实现）                                                                                                                                                                                                                    |
| 适用范围 | `packages/engine` 的世界书引擎模块（无 IO、纯函数）                                                                                                                                                                                              |
| 上游依据 | [Character Card V2 规范](https://github.com/malfoyslastname/character-card-spec-v2) 的 `character_book`；SillyTavern（ST）官方 World Info 文档；ST `release` 分支源码 `public/scripts/world-info.js`、`public/scripts/openai.js`（2026-09 抓取） |

标注体系同 `cards-spec.md`：**【对齐】**（有一手依据）／**【决定】**（自主规定）／**【⚠️ 待确认】**（须人类裁决，禁止拍板）。

交叉引用：条目来源与 `extensions` 保留策略见 `cards-spec.md`；段落编排、深度注入落点、tokenizer 契约与宏替换时机见 `prompt-assembly.md`。

## 1. 目的与范围

世界书引擎是纯函数：**输入聊天历史文本与条目集合，输出按插入位置分组的注入内容**（已排序、已限预算）。它不访问数据库、不发网络请求、不做宏替换、不内置 tokenizer（计数能力由调用方注入）。

v1 支持的功能集：主/副关键词匹配（四种组合逻辑）、constant 常驻、enabled 禁用状态、扫描深度（全局 + 逐条覆盖）、递归激活（开关 + 步数上限 + 逐条控制）、插入顺序与预算优先级、token 预算、三个注入位置（beforeChar / afterChar / atDepth）。其余 ST 能力全部"识别 + 保留 + 告警"，见 §9。

【决定】v1 引擎完全确定性（无随机源）：概率激活（probability）与包含组（inclusion group）不实现。

## 2. 数据模型

```ts
/** 注入位置。前三项 v1 实现；其余为已识别不实现（§9）。
 *  字符串值与 V2 character_book 的枚举语义对应；数字编码映射见 §8.2。 */
export type WorldInfoPosition =
  | "beforeChar"
  | "afterChar"
  | "atDepth"
  | "anTop"
  | "anBottom"
  | "beforeExample"
  | "afterExample"
  | "outlet";

/** 副关键词组合逻辑。语义与数值对齐 ST world_info_logic 枚举（源码）：
 *  andAny=0, notAll=1, notAny=2, andAll=3。 */
export type SelectiveLogic = "andAny" | "andAll" | "notAny" | "notAll";

/** atDepth 注入使用的消息角色。 */
export type InjectionRole = "system" | "user" | "assistant";

/** 单条世界书条目（规范化形态；V2 字段直映，ST 扩展从 entry.extensions.* 读出）。 */
export interface WorldInfoEntry {
  /** 稳定唯一 id（映射自 V2 id，缺失时导入器生成）。 */
  id: string;
  /** 备注/标题，不进 prompt。 */
  comment: string;
  /** 主关键词；任一命中即触发。空数组 + constant=false ⇒ 永不激活。 */
  keys: string[];
  /** 副关键词，仅 selective=true 时参与判定。 */
  secondaryKeys: string[];
  /** true 时要求主/副组合满足 logic；false 时忽略 secondaryKeys。【对齐】 */
  selective: boolean;
  /** selective=true 时的组合逻辑；默认 andAny。 */
  logic: SelectiveLogic;
  /** 激活后注入的正文。 */
  content: string;
  /** false = 禁用状态：任何阶段不激活、不占预算、不触发递归。【对齐】 */
  enabled: boolean;
  /** 常驻：无视关键词恒候选（仍受预算限制）。【对齐】 */
  constant: boolean;
  /** 插入顺序：值小 = 更靠 prompt 上方。默认 100。【对齐，三重依据见 §6.1】 */
  insertionOrder: number;
  /** 注入位置；默认 afterChar。 */
  position: WorldInfoPosition;
  /** position=atDepth 时生效；缺省 4（ST 源码 DEFAULT_DEPTH=4）。其余位置为 null。 */
  depth: number | null;
  /** position=atDepth 时的消息角色；缺省 system。其余位置为 null。 */
  role: InjectionRole | null;
  /** 逐条覆盖全局扫描深度；null=继承。【对齐】 */
  scanDepth: number | null;
  /** 逐条覆盖大小写敏感；null=继承。【对齐】 */
  caseSensitive: boolean | null;
  /** 逐条覆盖整词匹配；null=继承。【对齐】 */
  matchWholeWords: boolean | null;
  /** true = 本条目 content 不再触发其它条目的递归激活。【对齐】 */
  preventRecursion: boolean;
  /** true = 本条目不能被递归激活（仅初始扫描可命中）。【对齐】 */
  excludeRecursion: boolean;
  /** 未知扩展原样保留（cards-spec §7）；§9 未支持特性均落在此处。 */
  extensions: Record<string, unknown>;
}

/** 一本世界书（V2 character_book 的规范化形态）。 */
export interface WorldInfoBook {
  id: string;
  name: string | null;
  description: string | null;
  /** 书级扫描深度（V2 scan_depth）；null=用全局。 */
  scanDepth: number | null;
  /** 书级 token 预算（V2 token_budget）；null=用全局百分比预算（§6.3）。 */
  tokenBudget: number | null;
  /** 书级递归开关（V2 recursive_scanning）；null=用全局默认（false）。 */
  recursiveScanning: boolean | null;
  entries: WorldInfoEntry[];
  extensions: Record<string, unknown>;
}
```

## 3. 扫描文本的构建

激活判定的输入文本池 = **聊天历史窗口 + 作者注**（作者注本体属组装器，但按 ST 行为必须参与扫描）：

1. **扫描窗口**【对齐】：取 `chatHistory` 末尾 `scanDepth` 条消息。解析优先级：条目级 `entry.scanDepth` → 书级 `book.scanDepth` → 全局默认 **2**（ST 源码 `world_info_depth = 2`）。
   - `0`：不扫描任何聊天消息，仅评估 constant、作者注与递归（ST 文档语义）；
   - `1`：仅最后一条；以此类推。
2. **作者注**【对齐】：`authorNote` 文本始终并入初始扫描池，不受 scanDepth 限制（ST 文档 "only recursed entries and Author's Note are evaluated"）。
3. **Include Names**【对齐】：默认开启——扫描缓冲中每条消息拼为 `"{说话人显示名}: {内容}"`（ST 文档示例与源码默认 `world_info_include_names = true`）。关闭时仅用消息正文。
4. 匹配对"池中每条消息文本"分别进行；条目在某消息中命中即记命中。实现上拼接整池匹配须保证语义等价（跨消息边界不得产生假命中——消息间以 `\n` 分隔且整词匹配天然阻断）。
5. 【决定】v1 不支持正则 key。形如 `/.../flags` 的关键词按**字面文本**处理，并产出 `warn: regex_key_not_supported:<entryId>`；不得静默忽略该 key。

## 4. 激活判定

对每条 `enabled` 条目求值：

1. **constant=true** → 直接进入候选（activation=`constant`），跳过 2–4。
2. **主关键词**：`keys` 中**任一** key 在扫描池命中 → 候选（activation=`keyword`）。匹配规则：
   - 大小写：`entry.caseSensitive ?? settings.caseSensitive`，全局默认 **false**【对齐源码】；
   - 整词：`entry.matchWholeWords ?? settings.matchWholeWords`，全局默认 **false**【对齐源码 `world_info_match_whole_words = false`；注意 ST 官方文档写 "Enabled by default"，与源码初值矛盾——本规范以源码为准，差异列入开放问题 §10.1】；
   - 整词仅对单词 key 生效；key 含空格时始终按子串匹配。
3. **副关键词（selective=true）**：在主命中成立的基础上叠加 `logic` 判定（【对齐】语义取自 ST 文档 Optional Filter）：

   | logic    | 条件                                    |
   | -------- | --------------------------------------- |
   | `andAny` | 至少一个副 key 命中                     |
   | `andAll` | 全部副 key 命中                         |
   | `notAny` | 没有任何副 key 命中                     |
   | `notAll` | 并非全部副 key 命中（全部命中反而否决） |

   `selective=true` 且 `secondaryKeys` 为空 ⇒ 视为无副过滤（等价 selective=false）。【对齐 ST 文档 "If no arguments are provided, this flag is ignored"】

4. 未命中 → 不激活。
5. **空 content**：条目仍计为激活，但注入阶段跳过并记 `warn: empty_content_skipped:<entryId>`（对齐 ST 源码"空内容不入 prompt"）。

## 5. 递归激活

【对齐】已激活条目的 `content` 文本可以触发其它条目（官方文档示例：Entry#1 内容提到 "Rufus" ⇒ Entry#2 也被拉入）。

1. 开关：`book.recursiveScanning ?? settings.recursiveScanning`，全局默认 **false**【对齐源码】。
2. 流程：第 k 轮 sweep 新激活条目的 content 并入扫描池 → 第 k+1 轮对全量候选条目再执行 §4（跳过 `excludeRecursion=true` 的条目）；新激活条目 activation=`recursive`。
3. 步数上限 `maxRecursionSteps`【对齐 ST 文档语义】：
   - `0` = 不设轮次上限，仅受 token 预算约束（ST 源码默认 `0`）；
   - `1` = 实际等价禁用递归（初扫即停）；
   - `N≥2` = 允许 N-1 层嵌套激活。
4. 条目级控制：`preventRecursion`（本条 content 不进入下一轮扫描池）、`excludeRecursion`（本条不被递归轮激活，初始轮仍可）。
5. 收敛保证：每轮只处理"新增激活"条目；同一条目不重复激活。"Delay until recursion / Recursion Level" 不实现（§9）。

## 6. 排序、预算与优先级

### 6.1 插入位置排序（决定 prompt 中的先后）

【对齐】同一 position 分组内按 `insertionOrder` **升序**：值小者更靠 prompt 上方。依据（三重一致）：

- V2 规范：_"lower 'insertion order' = inserted higher"_；
- ST 官方文档：_"an entry with Order number 100 will appear in the context before an entry with Order number 250"_；
- ST 源码：按 `sortFn = (a,b) => b.order - a.order`（降序）遍历 + `unshift` 头插，注释 _"Appends from insertion order 999 to 1. Use unshift for this purpose"_——净效果为升序。

【决定】`insertionOrder` 相同的并列时，按 `id` 字典序稳定排序，保证输出可复现（ST 未承诺此点，属我们新增的确定性要求）。

### 6.2 预算竞争（决定谁被丢弃）

【对齐】激活集合按以下**保留优先级**从高到低逐条占用预算，**预算耗尽即停止**（后续条目即使命中也不激活）：

1. `constant` 激活；
2. 直接命中（关键词）激活；
3. 递归激活。

同层内部按 `insertionOrder` **降序**优先。依据（ST 官方文档原文）：_"Constant entries will be inserted first. Then entries with larger order numbers."_ 与 _"Entries inserted by directly mentioning their keys have higher priority than those that were mentioned in other entries' contents."_

⚠️ 注意 §6.1 与 §6.2 方向相反，这不是笔误：**order 大的条目排得更靠下（更晚出现），但更优先占用预算**。

### 6.3 预算额度

```
limit = book.tokenBudget ?? floor(contextSize × settings.wiBudgetPercent / 100)
```

- 多本书：各书独立额度、独立竞争；同层全局合并排序后按各自书的池执行【决定——对应"每本书一个 budget"语义，与 ST 全局池存在差异，列入开放问题 §10.3】。
- `wiBudgetPercent` 全局默认 **25**【对齐源码 `world_info_budget = 25`】。
- 单条 content 超出剩余额度 ⇒ **整条丢弃**，不截断（避免注入半句话）；计入 `droppedEntries`。【决定】ST 是否会截断单条未验证。
- `tokenCount` 基于宏替换后的文本（§7.3 执行顺序保证了这一点）。

## 7. 与组装器的接口

### 7.1 签名

```ts
/** 消息形态。content 必须已完成宏替换（§7.3）。 */
export interface WorldInfoScanMessage {
  role: "user" | "assistant" | "system";
  /** 说话人显示名（includeNames 前缀用）。 */
  name: string;
  content: string;
}

/** 极简 token 计数回调；正式定义见 prompt-assembly.md §4。 */
export type TokenCounter = (text: string) => number;

export interface ResolveWorldInfoInput {
  /** 按传入顺序处理（如 [卡内书, 全局书]）。 */
  books: readonly WorldInfoBook[];
  /** 正序聊天历史，最后一条 = 最新。 */
  chatHistory: readonly WorldInfoScanMessage[];
  /** 作者注文本（参与扫描池 §3.2）；无则 null。 */
  authorNote: string | null;
  settings: {
    scanDepth: number; // 默认 2
    includeNames: boolean; // 默认 true
    caseSensitive: boolean; // 默认 false
    matchWholeWords: boolean; // 默认 false
    recursiveScanning: boolean; // 默认 false（书级值优先）
    maxRecursionSteps: number; // 默认 0 = 仅预算限制
    contextSize: number;
    wiBudgetPercent: number; // 默认 25
  };
  countTokens: TokenCounter;
}

/** 一条已入选注入（组内已按 §6.1 排序）。 */
export interface WorldInfoInjection {
  entryId: string;
  bookId: string;
  position: "beforeChar" | "afterChar" | "atDepth";
  /** atDepth 专用；其余为 null。 */
  depth: number | null;
  /** atDepth 专用；其余为 null。 */
  role: InjectionRole | null;
  /** 原文（已随输入替换过宏，见 §7.3）。 */
  content: string;
  tokenCount: number;
  activation: "constant" | "keyword" | "recursive";
  insertionOrder: number;
}

export interface ResolveWorldInfoResult {
  /** 分组数组；每组内按 insertionOrder 升序、id 稳定排序。 */
  byPosition: {
    readonly beforeChar: readonly WorldInfoInjection[];
    readonly afterChar: readonly WorldInfoInjection[];
    readonly atDepth: readonly WorldInfoInjection[];
  };
  /** 按书分组的预算报告。 */
  budget: {
    limit: number;
    used: number;
    /** 因 §6.2/§6.3 被淘汰的条目 id（含命中但被丢弃者）。 */
    droppedEntries: readonly string[];
  }[];
  warnings: readonly string[];
}

/**
 * 世界书引擎唯一对外入口（纯函数、确定性）。
 * 输入：聊天历史文本与条目集合 + 全局设置 + 注入的计数能力。
 * 输出：按插入位置分组的注入内容。
 */
export function resolveWorldInfo(input: ResolveWorldInfoInput): ResolveWorldInfoResult;
```

### 7.2 atDepth 的聚合责任

引擎按 `(depth, role)` 输出条目数组；**合并成消息是组装器的责任**：同一 `(depth, role)` 槽位内多条 content 以 `\n` 连接。同深度内先后 = `insertionOrder` 升序。深度坐标与作者注共用，定义见 `prompt-assembly.md §5.2`。

### 7.3 宏替换的边界

【决定】引擎**不做**宏替换。调用方（组装器）必须在进入本引擎前完成：

1. `chatHistory[].content`、`authorNote` 已替换；
2. 各书 `entry.content` 的副本已替换（保留原文字段供 UI 与导出）。

这保证扫描所见、预算计数、最终注入三者文本一致。引擎对残留 `{{...}}` 不作特殊处理。

## 8. character_book / ST 扩展字段映射

### 8.1 V2 `character_book` 顶层

| V2 JSON                | 引擎字段               | 缺省 |
| ---------------------- | ---------------------- | ---- |
| `name` / `description` | `name` / `description` | null |
| `scan_depth`           | `scanDepth`            | null |
| `token_budget`         | `tokenBudget`          | null |
| `recursive_scanning`   | `recursiveScanning`    | null |
| `extensions`           | `extensions`           | `{}` |

### 8.2 V2 `entries[]`

| V2 JSON                                                                                                      | 引擎字段                                                                            | 缺省        |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------- |
| `keys` / `content` / `enabled` / `constant` / `selective` / `secondary_keys` / `comment` / `insertion_order` | 同名直映                                                                            | 见 §2       |
| `case_sensitive`                                                                                             | `caseSensitive`                                                                     | null        |
| `position`（`"before_char"｜"after_char"`）                                                                  | `position`                                                                          | `afterChar` |
| `id`                                                                                                         | `id`（字符串化；缺失时导入器生成稳定 id）                                           | 生成        |
| `name` / `priority`                                                                                          | 不进 prompt；原样保留 `extensions`【对齐 V2 规范 "not used in prompt engineering"】 | —           |
| `extensions`                                                                                                 | `extensions` + 按下表展开已知键                                                     | `{}`        |

ST 扩展键（一手依据：ST 源码 `originalWIDataKeyMap`）——读取顺序**先 extensions、后 V2 顶层**（position 的回退逻辑对齐源码 `entry.extensions?.position ?? (entry.position === 'before_char' ? before : after)`）：

| `entry.extensions` 键                                                                                                                                                                                                                                            | 引擎字段                          | 说明                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `position`                                                                                                                                                                                                                                                       | `position`                        | 数字编码：`0=beforeChar, 1=afterChar, 2=anTop, 3=anBottom, 4=atDepth, 5=beforeExample, 6=afterExample, 7=outlet`【对齐源码 world_info_position】；2/3/5/6/7 走 §9 |
| `depth`                                                                                                                                                                                                                                                          | `depth`                           | 缺省时 atDepth 条目按 4 处理【对齐源码 DEFAULT_DEPTH=4】                                                                                                          |
| `role`                                                                                                                                                                                                                                                           | `role`                            | 数字映射（0=system, 1=user, 2=assistant）【⚠️ 待确认，实现时以 ST 实测为准】                                                                                      |
| `scan_depth`                                                                                                                                                                                                                                                     | `scanDepth`                       |                                                                                                                                                                   |
| `case_sensitive`                                                                                                                                                                                                                                                 | `caseSensitive`                   |                                                                                                                                                                   |
| `match_whole_words`                                                                                                                                                                                                                                              | `matchWholeWords`                 |                                                                                                                                                                   |
| `prevent_recursion`                                                                                                                                                                                                                                              | `preventRecursion`                |                                                                                                                                                                   |
| `exclude_recursion`                                                                                                                                                                                                                                              | `excludeRecursion`                |                                                                                                                                                                   |
| `selective_logic` 或顶层 `selectiveLogic`                                                                                                                                                                                                                        | `logic`                           | 两处存储变体并存于社区卡；读取优先级【⚠️ 待确认，见 §10.2】                                                                                                       |
| 其余 ST 键（`probability`/`useProbability`、`sticky`/`cooldown`/`delay`、`group`/`group_weight`/`group_override`、`automation_id`、`character_filter`、`triggers`、`vectorized`、`delay_until_recursion`、`display_index`、`use_group_scoring`、`match_*` 系列） | **不映射**，原样留在 `extensions` | §9                                                                                                                                                                |

## 9. 明确不实现清单（识别 + 保留 + 告警）

下列 ST 能力 v1 不实现；对应数据一律保留（不丢弃）并产出 `warn: feature_unsupported:<name>`：

| 特性                                                                      | 运行时处置                                   |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| probability / useProbability（概率激活）                                  | 视为 100（恒通过）——注意这是**降级**而非忽略 |
| Inclusion Group / Group Weight / Prioritize Inclusion / Use Group Scoring | 条目照常竞争（等效无组去重）                 |
| Timed Effects（sticky / cooldown / delay）                                | 忽略（等效无时态）                           |
| anTop / anBottom / beforeExample / afterExample / outlet 位置             | 条目不注入，记 `droppedEntries` + 告警       |
| 正则 key                                                                  | 按字面处理 + 告警（§3.5）                    |
| Vector Storage / Vectorized                                               | 忽略                                         |
| Min Activations / Max Depth                                               | 忽略                                         |
| Delay until recursion / Recursion Level                                   | 忽略                                         |
| Additional matching sources（对描述/场景等匹配）                          | 忽略                                         |
| Automation ID / Character Filter / Triggers                               | 忽略                                         |
| budget_cap（绝对预算帽）                                                  | 忽略                                         |
| Lore Insertion Strategy（characterFirst / globalFirst）                   | 忽略（合并语义见 §6.3 与 §10.3）             |

## 10. 开放问题（实现里程碑开工前须人类裁决）

1. `matchWholeWords` 出厂默认：本规范取源码值 `false`；ST 文档措辞相反。需实测 ST 当前出厂行为后定稿。
2. `selectiveLogic` 存储位置的读取优先级（顶层 vs extensions，社区卡两种变体并存）。
3. 多书预算模型：v1 草案为"逐书独立池"；ST 实为"全局合并单池 + 来源拼接策略"。定稿前必须人类确认取哪种。
4. `extensions.role` 数字映射的实测确认。
5. 单条超预算：整条丢弃 vs 截断（ST 行为未验证）。
6. ST 原生 World Info 文件（非卡内嵌）的独立导入是否在范围。

## 11. 交叉引用

- 条目来源与扩展保留：`cards-spec.md` §3、§7、§8
- 注入去向、深度坐标、宏替换执行顺序：`prompt-assembly.md` §2、§5、§7
- `TokenCounter` 正式定义：`prompt-assembly.md` §4
