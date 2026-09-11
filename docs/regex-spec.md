# 正则脚本规范（Regex Scripts）

| 项目     | 内容                                                      |
| -------- | --------------------------------------------------------- |
| 状态     | 已实现（第一期）                                          |
| 范围     | 全局、角色卡、组装计划中的正则脚本；Prompt 与 AI 输出处理 |
| 兼容目标 | SillyTavern `regex_scripts` 数据结构；不复制其源码        |

## 1. 功能边界

正则脚本是顺序执行的文本变换规则，不等同于世界书的正则关键词。世界书正则关键词列入第二期；第一期遇到世界书中的 `/.../flags` 仍按现有字面关键词规则处理并告警。

脚本只执行 JavaScript `RegExp` 查找替换，不执行任意 JavaScript。非法表达式跳过并产出 `regex_invalid:<id>` 告警。

## 2. 数据模型

```ts
type RegexPlacement = "userInput" | "aiOutput" | "prompt" | "worldInfo" | "markdown";

interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: RegexPlacement[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: "none" | "raw" | "escaped";
  minDepth: number | null;
  maxDepth: number | null;
}
```

导入时同时接受 ST 的 camelCase、snake_case 字段和数字 placement；未知字段不影响脚本执行。规则顺序为全局 → 角色卡 → 组装计划，顺序相同的脚本按来源数组顺序执行。

## 3. 作用位置

| 位置        | 语义                                                  |
| ----------- | ----------------------------------------------------- |
| `userInput` | 只改变进入 Prompt 的用户消息副本                      |
| `aiOutput`  | 改变 AI 历史消息的 Prompt 副本，并改变聊天展示副本    |
| `prompt`    | 改变最终进入模型的文本副本，计 token 使用变换后的文本 |
| `worldInfo` | 改变世界书正文副本，影响世界书激活与注入              |
| `markdown`  | 预留给 Markdown 展示层；第一期引擎只提供执行能力      |

数据库始终保留原始消息；展示和 Prompt 使用派生副本。这样切换规则不会破坏历史原文。

## 4. 替换语义

- `findRegex` 支持 `/pattern/flags` 和无包裹的表达式。
- `replaceString` 支持 `{{match}}`、`$1`、`$2` 和 `$<name>`。
- `trimStrings` 在捕获值插入替换文本前逐项移除。
- `substituteRegex` 为 `none` 时不替换查找表达式宏；`raw` / `escaped` 分别以原文 / 正则转义形式替换 `{{char}}`、`{{user}}`。
- 每条规则至多按自身正则 flags 执行；规则之间按顺序串联。

## 5. 作用域与存储

- 全局规则存于 settings 单例的 `regex_scripts` JSON 列。
- 角色级规则读取角色卡 `extensions.regex_scripts`。
- 预设级规则读取组装计划 `extensions.regex_scripts`。
- 角色卡和预设导入必须继续保留这些扩展字段。

## 6. 测试要求

引擎覆盖顺序执行、flags、捕获组、命名组、`trimStrings`、非法表达式、禁用状态、作用位置和 ST 字段导入；服务端覆盖全局规则 CRUD、Prompt 请求体变换、AI 输出展示变换和原始消息不变。
