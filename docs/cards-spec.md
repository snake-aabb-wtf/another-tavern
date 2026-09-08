# 角色卡规范（V2 基线）

|          |                                                                                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | 评审中（M1 规格文档，未实现）                                                                                                                               |
| 适用范围 | `packages/engine` 的角色卡解析模块                                                                                                                          |
| 上游依据 | [Character Card V2 规范](https://github.com/malfoyslastname/character-card-spec-v2)（含 V1 规范）、SillyTavern（下称 ST）`release` 分支源码（2026-09 抓取） |

## 标注体系

本文档所有行为条款使用三种标注，审阅与实现时必须区分：

- **【对齐】**——有一手依据（社区规范原文或 ST 源码/官方文档），按来源实现，不得擅自偏离。
- **【决定】**——我们自主规定的规则，可评审修改，但实现前必须以本文档为准。
- **【⚠️ 待确认】**——未能一手验证或来源互相矛盾，实现前必须向人类确认，禁止拍板。

## 1. 目的与范围

角色卡解析器负责把外部卡片文件转换为本项目统一的内存模型 `CharacterCard`，供世界书引擎与 Prompt 组装器消费。

支持范围（v1）：

| 容器             | 格式                  | 支持                                                                                           |
| ---------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| `.png` / `.apng` | V2（`chara_card_v2`） | ✅ 支持                                                                                        |
| `.png` / `.apng` | V1（平铺六字段）      | ✅ 支持（映射为 V2，见 §6）                                                                    |
| `.json`          | V2 / V2-data / V1     | ✅ 支持（判定顺序见 §5）                                                                       |
| `.jpg`           | ST JPEG 卡            | ❌ 暂不支持，【⚠️ 待确认】ST 已实现 JPEG 卡但无公开规范；是否纳入需人类决策                    |
| `.webp`          | —                     | ❌ 不支持（V1 规范明确排除："Not covered by the spec due to technical ambiguities"）【对齐】   |
| V3 卡（`ccv3`）  | chara_card_v3         | ❌ 不支持，显式报错【决定】。社区存在 V3 规范及 `ccv3` PNG chunk，未经本仓库验证，列入开放问题 |

## 2. 顶层结构

【对齐】V2 规范原文：

```ts
type TavernCardV2 = {
  spec: "chara_card_v2";
  spec_version: "2.0";
  data: CardData;
};
```

判定规则：

1. JSON 顶层含 `spec === "chara_card_v2"` → 按 V2 解析。
2. 无 `spec` 但含 `data` 对象 → 按"裸 V2"处理（`data` 即 `CardData`），产生警告 `spec_missing`。【决定】宽容导入，理由见 §8。
3. 其余 → 按 V1 平铺解析（§6）。

## 3. `data` 字段总表

类型以 V2 规范 TS 定义为准。"用法"图例：✅ 参与 prompt 组装；📋 仅 UI 展示/过滤；📦 透传保留。

| 字段                        | V2 要求                   | 类型            | 用法 | 注入去向 / 说明                                                                                  |
| --------------------------- | ------------------------- | --------------- | ---- | ------------------------------------------------------------------------------------------------ |
| `name`                      | 必填                      | `string`        | ✅   | 宏 `{{char}}` 的取值来源；本身不作为独立段落注入                                                 |
| `description`               | 必填                      | `string`        | ✅   | → 组装器"角色描述"段                                                                             |
| `personality`               | 必填（V1 全字段必填语义） | `string`        | ✅   | → personality 段；空串时整段跳过【决定】                                                         |
| `scenario`                  | 必填（V1）                | `string`        | ✅   | → scenario 段                                                                                    |
| `first_mes`                 | 必填（V1）                | `string`        | ✅   | 开场消息（greeting），作为第一条 assistant 消息                                                  |
| `mes_example`               | 必填（V1）                | `string`        | ✅   | → 对话示例段，`<START>` 分块（见 prompt-assembly §裁剪）                                         |
| `creator_notes`             | 可选                      | `string`        | 📋   | 规范 MUST NOT 进 prompt【对齐】                                                                  |
| `system_prompt`             | 可选                      | `string`        | ✅   | 覆盖全局 main prompt；空串时回退全局/内部默认；必须支持 `{{original}}` 占位符【对齐，规范 MUST】 |
| `post_history_instructions` | 可选                      | `string`        | ✅   | 覆盖全局 PHI（jailbreak）；注入于聊天历史之后；空串回退；`{{original}}`【对齐，规范 MUST】       |
| `alternate_greetings`       | 可选                      | `string[]`      | ✅   | 开场候选列表，用户选择其一替代 `first_mes`；规范 MUST 提供 swipe 机制【对齐】                    |
| `character_book`            | 可选                      | `CharacterBook` | ✅   | 映射为世界书引擎输入，字段映射见 world-info-spec.md §8；默认启用                                 |
| `tags`                      | 可选                      | `string[]`      | 📋   | 规范 SHOULD NOT 进 prompt【对齐】                                                                |
| `creator`                   | 可选                      | `string`        | 📋   | 规范 MUST NOT 进 prompt【对齐】                                                                  |
| `character_version`         | 可选                      | `string`        | 📋   | 规范 MUST NOT 进 prompt【对齐】                                                                  |
| `extensions`                | 必填，默认 `{}`           | `object`        | 📦   | 规范 MUST：默认空对象、不得销毁未知键值对【对齐】                                                |

未在本表中的 `data` 属性一律按未知字段处理（§7）。

## 4. PNG 内嵌格式

【对齐】存储方式：

- PNG `tEXt` chunk，keyword 为 `chara`，text 值 = `base64(UTF-8 JSON)`。
- V1 规范原文措辞为 "Chara EXIF metadata field"（历史沿称）；社区通用实现即 PNG tEXt chunk，keyword 小写 `chara`。
- 解析器查找 keyword 时**大小写不敏感**（兼容个别工具写出 `Chara`）。【决定】宽容导入。

解析失败错误码：

| 错误码                 | 条件                                         |
| ---------------------- | -------------------------------------------- |
| `png_chunk_not_found`  | 无 `chara` tEXt chunk                        |
| `base64_decode_failed` | chunk 内容非法 base64                        |
| `json_parse_failed`    | 解码后非法 JSON                              |
| `spec_unsupported`     | `spec` 值非 `chara_card_v2` 且无法按 V1 解析 |

APNG 按 PNG 处理（tEXt 语义相同）。

## 5. JSON 卡

判定顺序（【决定】，覆盖社区实际存在的三种形态）：

1. `{spec, spec_version, data}` → 标准 V2。
2. `{data}`（无 `spec`）→ 裸 V2，`data` 即 `CardData`，警告 `spec_missing`。
3. 平铺六字段（§6）→ V1。

## 6. V1 兼容映射

【对齐】V1 规范：六个字段 `name` / `description` / `personality` / `scenario` / `first_mes` / `mes_example` 全部必填，且**必须默认为空字符串**（不是 `null` 或缺失）。

映射规则：

- V1 对象原样成为 V2 的 `data`；补齐 `spec: "chara_card_v2"`、`spec_version: "2.0"`。
- 缺失字段补默认值：`string` → `""`，数组 → `[]`，`extensions` → `{}`；每处补默认产生一条 `warning`，**不硬失败**。【决定】宽容导入优先——目标用户的存量卡常见字段残缺，导入成功率高比严格校验更符合产品判断（AGENTS.md §2.2）。
- V1 宏别名 `<BOT>`、`<USER>` 与 `{{char}}`、`{{user}}` 等价，大小写不敏感【对齐】。
- V1 卡的 `first_mes` 必须是聊天中的第一条消息（bot 先发言）【对齐】。

## 7. 扩展与未知字段策略

核心原则（【对齐】规范原文："they must never be destroyed"）：**任何字段不得静默丢弃**。

1. `data.extensions` 与每个 `entry.extensions` 内的未知键值：原样保留，round-trip 导出时写回。
2. `data` 顶层未知字段、`entry` 顶层未知字段：解析模型保留为 `unknownFields`，round-trip 导出时**写回原位**（不合并进 `extensions`，避免篡改原始结构）。【决定】
3. 本项目自己的扩展统一放在 `data.extensions.another_tavern` 命名空间下（规范 SHOULD namespace）。
4. ST 扩展字段位于 `entry.extensions.*`（一手依据：ST 源码 `originalWIDataKeyMap`），消费规则见 world-info-spec.md §8.2。

Round-trip 目标：导入 → 导出为**语义无损**（全部键值保留、未知字段原位写回）；不承诺字节级一致（空白、键序不保证）。

## 8. 解析管线与宽容导入

管线：容器解码 → JSON 解析 → spec 判定 → 字段规范化 → 产出 `{ card: CharacterCard, warnings: Warning[] }`。

- **宽容导入原则**【决定】：任何字段级问题只产生 warning 并继续（补默认值），只有结构不可解析（§4 错误码）才硬失败。
- 必填字段（V1 六字段）缺失/类型不符：补默认值 + `warning: field_missing` / `field_type_mismatch`。
- `alternate_greetings` 非数组：尝试包裹为单项数组，否则置 `[]` + warning。

## 9. 交叉引用

- 世界书条目模型：`world-info-spec.md` §2；`character_book` / ST 扩展字段映射：§8
- 字段注入位置与组装顺序：`prompt-assembly.md` §2、§3
- 宏替换时机与完整规则：`prompt-assembly.md` §7（宏集合定义见本文 §6 关联内容）
