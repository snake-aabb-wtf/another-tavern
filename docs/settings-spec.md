# 连接设置与采样参数规范（Settings / Sampling）

|          |                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | 已实现（本规格即当前行为：M6 设置页 + 采样 7 键契约）                                                                                                                                                                                                                                                                                 |
| 适用范围 | `packages/server` 的 `/api/settings` 与 `/api/chat/stream`；`packages/web` 的设置页（`SettingsPage`）                                                                                                                                                                                                                                 |
| 上游依据 | [OpenAI API Reference · Chat/create](https://platform.openai.com/docs/api-reference/chat/create)、[vLLM OpenAI-Compatible Chat Completion Protocol](https://docs.vllm.ai/en/v0.18.1/api/vllm/entrypoints/openai/chat_completion/protocol/)、[Stack Overflow：OpenAI 端点拒收未识别参数](https://stackoverflow.com/questions/77112137) |

标注体系同 `cards-spec.md`：**【对齐】**（有一手依据）／**【决定】**（自主规定）。

交叉引用：请求体的 `messages` 由组装器产出，段序与预算规则见 `prompt-assembly.md`；本文只规定连接设置、采样参数与其发送契约。

## 1. 设置资源模型

设置是**全局单例资源**（settings 表固定一行），字段如下【决定】：

| 字段            | 类型               | 语义                                                                                      |
| --------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `baseUrl`       | `string`           | OpenAI 兼容上游根地址（如 `https://api.example.com/v1`），chat 时拼接 `/chat/completions` |
| `apiKey`        | `string`           | **写入不回读**：GET 永远返回打码值 + `hasApiKey` 布尔（§4.1）                             |
| `model`         | `string`           | 模型名，原样透传上游请求体的 `model` 字段                                                 |
| `sampling`      | `object`（不透明） | 采样参数容器：服务端不校验内部键名与值类型，唯一干预点是发送白名单（§3）                  |
| `defaultPlanId` | `string \| null`   | 全局默认组装计划；`null` = 引擎内置默认                                                   |

【决定】`sampling` 按**不透明 JSON 对象**对待：服务端不知道也不关心里面有哪些键，语义上「键缺失 = 不发送该参数」（§2）。这让扩展键（未来纳入白名单的新键、调试期手工写入的键）可以整体存取，而无需迁移 schema。

## 2. 采样参数表（7 键）

UI 与白名单共同支持的 7 键全集【决定】。语义与边界依据见「§7 参考」。

| 键                  | 类型      | UI 提示范围 | 语义                                   |
| ------------------- | --------- | ----------- | -------------------------------------- |
| `temperature`       | `number`  | 0–2         | 采样温度                               |
| `top_p`             | `number`  | 0–1         | 核采样（nucleus sampling）             |
| `max_tokens`        | `integer` | ≥ 1         | 最大生成 token 数                      |
| `frequency_penalty` | `number`  | -2–2        | 频率惩罚                               |
| `presence_penalty`  | `number`  | -2–2        | 存在惩罚                               |
| `stop`              | `string`  | —           | **单条停止串**（非 OpenAI 的数组形式） |
| `seed`              | `integer` | —           | 随机种子（固定 seed 可复现采样）       |

核心语义【决定】：

- **键缺失 = 不发送该参数**。设置页文案「留空 = 不发送该参数」即此语义；上游请求里出现哪些采样键，完全由 sampling 里存了哪些键决定。
- **宽松契约（有意为之）**：范围只由 UI 提示（min/max/step），服务端不做范围强校验，也不做类型强校验——白名单内值原样透传。理由：OpenAI 官方端点、vLLM、llama.cpp 及各类代理网关对同一参数的边界定义并不一致，服务端强校验反而会把合法上游挡在门外；越界或类型错误的后果由上游自身的参数校验返回。

## 3. 发送白名单

chat 请求构造（`POST /api/chat/stream` → 上游 `/chat/completions`）时【决定】：

- 白名单**恰好**为 §2 的 7 键：`temperature` / `top_p` / `max_tokens` / `frequency_penalty` / `presence_penalty` / `stop` / `seed`（`SAMPLING_WHITELIST`，`packages/server/src/routes/chat.ts`）。
- **白名单外的 sampling 键一律静默丢弃**：不报错、不告警、不透传。手工或 API 存入的扩展键（如 `top_k`）会保存在 sampling 里（§4.3 保证不被 UI 抹掉），但**保留 ≠ 发送**。
- 白名单内键的值类型按 §2 表（UI 写入契约；`stop` 为单条字符串、`seed` 为整数），服务端透传原值。
- `stream: true` 由服务端固定注入，不可配置【决定】：本产品仅支持流式对话，`stream` 不属于采样参数，UI 不暴露。

## 4. API 契约

### 4.1 GET /api/settings

返回全量设置；`apiKey` 永远是打码值（`maskApiKey`：长度 ≤ 8 全掩码 `****`，否则前 3 位 + `…` + 后 4 位），另附 `hasApiKey` 布尔供 UI 判断是否已配置【决定】。

### 4.2 PUT /api/settings（全量替换）

- `baseUrl` / `model`：以提交值覆盖，缺省按空串。
- `apiKey`：空串或缺省 = **保留原值**（前端不回显明文，只有用户输入新 key 才更新）。
- `sampling`：**整体替换**，不与旧值合并；缺省或非对象 = `{}`。
- `defaultPlanId`：缺省 = 保留；`null` = 清除（回落引擎内置默认）；字符串须指向已存在的计划，否则 404。

### 4.3 合并语义（UI 侧义务）

【决定】PUT 对 sampling 是整体替换，因此设置页保存时**必须**以已加载的 `settings.sampling` 为底对象、只应用 7 个表单键后整体提交：

- 表单空串 → `delete` 该键（= 不发送）；
- 表单非空 → 写入（数字键转 `number`）；
- 底对象中其余未知键**原样保留**——这正是白名单设计下「手工/API 存入的扩展键不被 UI 抹掉」的语义（保留 ≠ 发送，发送仍以 §3 白名单为准）。

任何「只用表单字段重建 sampling」的实现都是 bug（保存会清掉全部扩展键）；M6 设置页曾存在此问题，已按本节修复。

### 4.4 现状与风险：非法 JSON 请求体

【决定】（暂不改动）请求体不是合法 JSON 时，服务端按空对象 `{}` 处理（`.catch(() => ({}))`）→ 等价于把 `baseUrl` / `model` / `sampling` 全部清成空值。风险：调用方（脚本、第三方客户端）发错 Content-Type 或发送被截断的 JSON 会**静默清空配置**。暂保留宽松行为以匹配 M3 语义；如后续收紧为 400，属行为变更，须先修订本节。

## 5. 已知限制与排除决策

- **`top_k` / `min_p` 有意不进白名单**【决定】：OpenAI 官方端点对未识别参数返回 400（§7 Stack Overflow 证据），与「任意 OpenAI 兼容上游」的产品定位冲突——白名单必须保守。需要 `top_k` 的 vLLM / 本地上游用户当前无途径注入该参数（即使手工写入 sampling 也会在发送时被丢弃）。
- **推理系模型不自动适配**【决定】：OpenAI o 系等推理模型拒收 `max_tokens`（要求 `max_completion_tokens`）；当前不做模型名探测与参数自动改名，列为已知限制——对这类模型，`max_tokens` 会原样发出并由上游报错。
- **采样为全局单值**【决定】：sampling 属于全局设置，所有会话共用一份；会话级 / 计划级采样覆盖属未来工作。
- **不暴露 `n` / `logit_bias` / `logprobs` / `response_format` 等**【决定】：`n` 与本产品自带的 swipe 候选机制重复；`logit_bias` / `logprobs` / `response_format` 对角色扮演场景无意义或过于专有、调试向。
- **非法 JSON 请求体静默清空配置**（§4.4 风险提示）。

## 6. UI 暴露清单

设置页（`packages/web/src/components/SettingsPage.tsx`）采样 fieldset 暴露 §2 全部 7 键，全部遵循「留空 = 不发送该参数」；控件类型与步进/边界【决定】：

| 键                  | 控件   | step | min | max |
| ------------------- | ------ | ---- | --- | --- |
| `temperature`       | number | 0.1  | 0   | 2   |
| `top_p`             | number | 0.05 | 0   | 1   |
| `max_tokens`        | number | 1    | 1   | —   |
| `frequency_penalty` | number | 0.1  | -2  | 2   |
| `presence_penalty`  | number | 0.1  | -2  | 2   |
| `stop`              | text   | —    | —   | —   |
| `seed`              | number | 1    | —   | —   |

- 视觉与交互遵守 AGENTS §6c：`panel` / `label-base` / `input-base` 共享原语类；文案一律引用 `packages/web/src/ui-text.ts` 常量。
- 回显：7 键从 `sampling` 安全读取——数值键仅接受有限 `number`（`NaN` / 其它类型 → 回显空串），`stop` 仅接受 `string`。
- 保存：按 §4.3 合并语义提交（底对象 + 7 键应用，未知键保留）。

## 7. 参考

- OpenAI API Reference · Chat/create（7 键语义、`stream` 行为、官方端点对未识别参数返回 400）：https://platform.openai.com/docs/api-reference/chat/create
- vLLM OpenAI-Compatible Chat Completion Protocol（兼容上游的参数面与 `seed` 等扩展）：https://docs.vllm.ai/en/v0.18.1/api/vllm/entrypoints/openai/chat_completion/protocol/
- Stack Overflow：OpenAI API 对未识别请求参数返回 400（`top_k` / `min_p` 排除依据）：https://stackoverflow.com/questions/77112137
