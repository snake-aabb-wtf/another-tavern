# AGENTS.md —— 本仓库的 Agent 工作规则

任何 Agent（AI 或人类）在本仓库工作前必须遵守本文件。规则的优先级高于任何个人的"最佳实践"判断。

## 1. 开工前必读

- [README.md](./README.md)
- 本文件（AGENTS.md）
- `docs/` 下全部文档——三份规格文档（cards-spec / prompt-assembly / world-info-spec）是本项目的"法律"，是后续实现的唯一依据，开工前必须全部读完
- 文档中标注【⚠️ 待确认】的条目：触及即停，向人类确认后再实现
- `git log` 浏览最近提交，确认当前进度与里程碑

## 2. 产品判断（所有决策的依据）

1. 核心价值在"提示词组装引擎"：把角色卡、用户人设、世界书、聊天历史在 token 预算内按规则组装成最终请求。UI 只是皮，引擎是灵魂。
2. 必须兼容 ST 角色卡导入（V2 规范，PNG 内嵌 JSON）。存量卡片资产能否无损迁移直接决定采用率。
3. 目标用户多为非程序员、自托管（Windows 为主），安装体验是生死线（后续计划 Bun 单文件分发）。

任何与这三条冲突的设计决策，都应提出并上报，而不是直接实现。

## 3. 架构分层（不可违反）

- `packages/engine`：无头引擎。**禁止**任何 UI 依赖、网络请求、数据库访问。
- `packages/sse`：纯 SSE 文本解析。**禁止**网络请求、UI 依赖、数据库访问和业务语义。
- `packages/server`：Hono API + SSE 流式 + SQLite（Drizzle ORM）。只能调用 engine 获取组装结果，不得在 server 内复制引擎逻辑。
- `packages/web`：只与 server 通信（HTTP / SSE），不得直接访问 SQLite 或引擎内部。
- 业务依赖方向严格单向：`web → server → engine`。`web` 与 `server` 可共同依赖 `packages/sse`；该包不得反向依赖任何业务包。

## 4. 技术栈锁定

不得更改，不得自行引入新框架或库：

| 层     | 技术                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| 仓库   | pnpm workspaces；TypeScript strict 全开；vitest；eslint + prettier                         |
| server | Hono + Drizzle ORM（SQLite）                                                               |
| web    | Vite + React + Tailwind（禁用 Next.js 与一切组件库）                                       |
| 运行时 | Node ≥ 22.5（M7 发布基线，`node:sqlite` 需要此版本），保持与 Bun 兼容（禁用 Bun 特有 API） |

## 5. 依赖政策

- 不得自行引入任何新依赖（含 devDependencies）。`@types` 类型包同样需要先说明理由再添加。
- 确实需要新依赖才能继续时：**停下来向人类提问并等待批准**，不得默默安装。
- 说明：`typescript-eslint`、`eslint-config-prettier` 属于"eslint + prettier"工具链本身，M0 已引入；除此之外的新增一律先问。
- 值得注意的既有决定：TypeScript 锁定在 5.9.x（typescript-eslint 8.70 要求 `typescript <6.1.0`，TS 7 暂不受支持）。

## 6. 行为规则

- 发现 spec 冲突、缺口或歧义：**必须停下来向人类提问**，不得自行决定，不得猜测后继续。
- 只做当前任务范围内的事。不做未经指派的"顺手"功能（新路由、新数据表、新 UI 组件等一律不算顺手）。
- 分发与 CI 相关工作（Dockerfile、GitHub Actions、Bun 打包）仅限发布里程碑（M7 起已建立基线，后续改动须与既有 CI/分发配置一致）。
- 不放宽配置：不得在包内覆盖根 `tsconfig.base.json` 的 strict 项，不得添加 eslint disable 除非附注释说明原因。

## 6b. 开源协作（M7 起，公开仓库生效）

- **许可证红线**：本仓库以 MIT 发布。**严禁引入、复制或移植任何 SillyTavern（AGPL-3.0）源码**；与 ST 的兼容仅限文件格式层面（JSON/PNG 数据结构）。引用其行为时只能基于公开文档与对行为的独立分析，不得粘贴其源码。引入任何第三方代码/资产前必须核实其许可证允许 MIT 再分发，并在文件头注明来源。
- **docs/ 是唯一实现依据**：行为规格、字段表、接口契约以 docs/ 为准；改行为先改 docs（或提交提案）。
- **Commit / PR 规范**：Conventional Commits（`feat:`/`fix:`/`docs:`/`chore:`/`test:`）；一个 PR 一个主题；PR 描述必须包含动机、改动点、验证方式（贴命令输出）；提交前 `pnpm format && pnpm lint && pnpm test` 全绿。
- **UI 文案**：界面文案一律使用 `packages/web/src/ui-text.ts` 中的常量，不得在组件内硬编码字符串（为 i18n 铺路；新增文案先加常量再引用）。
- **秘钥与数据**：API key、聊天记录只存在于本地 SQLite（`packages/server/data/`），已被 .gitignore 排除；任何真实凭据严禁进入代码、测试与提交历史。

## 6c. UI 视觉基调（M7 后确立：「烛下酒馆」）

- **风格锚点**：深夜自托管小酒馆——暖褐黑多层底色、烛焰琥珀（candle）为唯一强调色、黄铜（brass）辅色、羊皮纸（parchment）角色消息卡为签名元素；衬线展示字体（`font-display`）只用于招牌与页标题。禁止紫渐变、玻璃拟态、默认蓝等模板化（AI slop）样式，禁止纯装饰性的新动效。
- **颜色唯一来源**：`packages/web/src/index.css` 的 `@theme` 令牌（tavern / candle / brass / parchment / ink / ember / moss）。组件内禁止出现 Tailwind 默认色阶字面量（`neutral-*` / `blue-*` / `amber-*` / `red-*` 等）与裸 hex；需要新颜色先加令牌再引用。
- **复用交互原语**：按钮、输入框、面板、页标题一律使用 `index.css` `@layer components` 中的共享类（`btn-primary` / `btn-secondary` / `btn-ghost` / `btn-ghost-danger` / `input-base` / `label-base` / `panel` / `panel-pop` / `page-title` 等），不得在组件内手写同类样式。
- **状态纪律**：可交互元素必须有 hover、`focus-visible`（琥珀外圈）与 disabled（40% 透明）；成功 = moss、失败 = ember、进行中 = 琥珀；动效仅限既有 keyframes（`msg-enter` / `breathe`），且必须尊重 `prefers-reduced-motion`。
- **单一暗色主题**是既定方向，不做主题切换；签名元素（羊皮纸消息卡）是全场唯一记忆点，其余保持安静。
- **视觉交付验收**：改动 UI 时除 §8 门禁外，须同步刷新 `docs/screenshots/`，保证 README 图文一致。

## 7. 代码规范

- TypeScript strict（继承根 `tsconfig.base.json`）；不使用 `any`；`@ts-expect-error` 必须附注释说明原因。
- 全仓库 ESM。可构建包（engine / server，`module: nodenext`）的相对导入必须带 `.js` 扩展名。
- 导出的符号写一句 JSDoc 说明职责。
- 每个包用 `tsconfig.json`（编辑器 + 全量类型检查，noEmit）与 `tsconfig.build.json`（产物构建，排除测试）两层配置。

## 8. 交付定义（Definition of Done）

交付前以下命令必须全部通过，缺一不可：

1. `pnpm install`（依赖有变动时）
2. `pnpm build`
3. `pnpm test`
4. `pnpm lint` 与 `pnpm format:check`（提交前先跑 `pnpm format`）

同时：

- 新增命令必须登记进 README「常用命令」。
- README 与 AGENTS.md 必须和实际结构一致，**不写没做到的东西**。
- 交付报告必须包含：执行的命令与结果、创建/修改的文件清单、所有自主决定及理由。

## 9. 常用命令

同 README「常用命令」一节。
