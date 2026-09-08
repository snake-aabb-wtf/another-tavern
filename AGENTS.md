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
- `packages/server`：Hono API + SSE 流式 + SQLite（Drizzle ORM）。只能调用 engine 获取组装结果，不得在 server 内复制引擎逻辑。
- `packages/web`：只与 server 通信（HTTP / SSE），不得直接访问 SQLite 或引擎内部。
- 依赖方向严格单向：`web → server → engine`。

## 4. 技术栈锁定

不得更改，不得自行引入新框架或库：

| 层     | 技术                                                               |
| ------ | ------------------------------------------------------------------ |
| 仓库   | pnpm workspaces；TypeScript strict 全开；vitest；eslint + prettier |
| server | Hono + Drizzle ORM（SQLite）                                       |
| web    | Vite + React + Tailwind（禁用 Next.js 与一切组件库）               |
| 运行时 | Node ≥ 20，保持与 Bun 兼容（禁用 Bun 特有 API）                    |

## 5. 依赖政策

- 不得自行引入任何新依赖（含 devDependencies）。`@types` 类型包同样需要先说明理由再添加。
- 确实需要新依赖才能继续时：**停下来向人类提问并等待批准**，不得默默安装。
- 说明：`typescript-eslint`、`eslint-config-prettier` 属于"eslint + prettier"工具链本身，M0 已引入；除此之外的新增一律先问。
- 值得注意的既有决定：TypeScript 锁定在 5.9.x（typescript-eslint 8.70 要求 `typescript <6.1.0`，TS 7 暂不受支持）。

## 6. 行为规则

- 发现 spec 冲突、缺口或歧义：**必须停下来向人类提问**，不得自行决定，不得猜测后继续。
- 只做当前任务范围内的事。不做未经指派的"顺手"功能（新路由、新数据表、新 UI 组件等一律不算顺手）。
- 不引入 Docker、CI、发布配置、Bun 打包，除非任务明确要求。
- 不放宽配置：不得在包内覆盖根 `tsconfig.base.json` 的 strict 项，不得添加 eslint disable 除非附注释说明原因。

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
