# Another Tavern

开源、自托管优先的 AI 角色扮演框架，定位为 [SillyTavern](https://github.com/SillyTavern/SillyTavern)（下称 ST）的平替。
核心价值在**提示词组装引擎**：把角色卡、用户人设、世界书（lorebook）、聊天历史在 token 预算内按规则组装成最终请求——UI 只是皮，引擎是灵魂。

## 当前状态

- **M0** 脚手架：pnpm workspace + 三包骨架 + 工具链（TypeScript strict / vitest / eslint / prettier）✅
- **M1** 规格文档：`docs/` 三份规范，是实现的**唯一依据**（见下表）✅
- **M2** 引擎：角色卡解析、世界书引擎、tokenizer、Prompt 组装器（`packages/engine`，104 tests）✅
- **M3** 后端与端到端链路：SQLite(Drizzle 迁移) + REST API + SSE 流式对话 + 探针页 ✅
- **M4** 正式前端：未开始

## 规格文档（docs/）

| 文档                                                 | 内容                                                                | 状态   |
| ---------------------------------------------------- | ------------------------------------------------------------------- | ------ |
| [docs/cards-spec.md](./docs/cards-spec.md)           | 角色卡规范：V2 字段全表、PNG/JSON 容器、V1 兼容、扩展保留策略       | 评审中 |
| [docs/prompt-assembly.md](./docs/prompt-assembly.md) | Prompt 组装规范：段序、token 预算与裁剪、tokenizer 策略、端到端示例 | 评审中 |
| [docs/world-info-spec.md](./docs/world-info-spec.md) | 世界书引擎规范：激活/排序/预算/递归规则、与组装器的 TS 接口         | 评审中 |

## 架构分层

依赖方向严格单向：`web → server → engine`，禁止反向依赖。

```text
┌──────────────────────────────────────────────────┐
│  packages/web                                    │
│  Vite + React + Tailwind SPA                     │
│  只与 server 通信（HTTP / SSE），不碰引擎与数据库 │
└───────────────┬──────────────────────────────────┘
                │ HTTP / SSE
┌───────────────▼──────────────────────────────────┐
│  packages/server                                 │
│  Hono API + SSE 流式 + SQLite 存储（Drizzle ORM） │
│  只通过 engine 完成组装逻辑，不复制引擎实现       │
└───────────────┬──────────────────────────────────┘
┌───────────────▼──────────────────────────────────┐
│  packages/engine                                 │
│  无头引擎：角色卡解析 · 世界书引擎 ·              │
│  Prompt 组装器 · tokenizer 接口                   │
│  禁令：零 UI 依赖、不发网络请求、不碰数据库       │
└──────────────────────────────────────────────────┘
```

## 各包职责

| 包                | 职责                                                                                                                            | 当前状态                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/engine` | 无头引擎：角色卡（ST V2，PNG 内嵌 JSON）解析、世界书引擎、Prompt 组装器、tokenizer 接口。零 UI 依赖、不发网络请求、不碰数据库。 | M2 完成：104 tests + golden files                                        |
| `packages/server` | Hono API + SSE 流式 + SQLite 存储（Drizzle ORM），调用 engine。                                                                 | M3 完成：卡导入 / 会话消息 CRUD / settings / `POST /api/chat/stream` SSE |
| `packages/web`    | Vite + React + Tailwind SPA，只跟 server 通信。                                                                                 | M3：`Probe.tsx` 链路探针（临时页，M4 重做正式前端）                      |

## 技术栈（锁定，不得替换）

- pnpm workspaces monorepo；TypeScript（strict 全开，根 `tsconfig.base.json` 统一继承）；vitest；eslint + prettier
- server：Hono + Drizzle ORM（SQLite，驱动为 Node 内置 `node:sqlite` + drizzle sqlite-proxy；迁移由 drizzle-kit 生成）
- web：Vite + React + Tailwind（禁用 Next.js 与一切组件库）
- 运行时 Node ≥ 22.5（M3 决策：`node:sqlite` 内置驱动），保持与 Bun 兼容（不使用 Bun 特有 API）

## 常用命令

| 命令                                         | 作用                                                         |
| -------------------------------------------- | ------------------------------------------------------------ |
| `pnpm install`                               | 安装依赖                                                     |
| `pnpm dev`                                   | **一条命令同时启动 server(:3001) 与 web(:5173)**（并行）     |
| `pnpm build`                                 | 依次构建全部包（engine → server → web，按拓扑顺序）          |
| `pnpm test`                                  | 运行全部 vitest 测试                                         |
| `pnpm typecheck`                             | 对全部包运行 `tsc --noEmit`（含测试文件）                    |
| `pnpm lint`                                  | ESLint 检查全部源码                                          |
| `pnpm format`                                | Prettier 格式化（提交前先跑一遍）                            |
| `pnpm format:check`                          | Prettier 格式校验                                            |
| `pnpm --filter @another-tavern/server start` | 仅启动 server（需先 build；`PORT`/`DB_PATH` 环境变量可覆盖） |
| `pnpm --filter @another-tavern/web dev`      | 仅启动 web 开发服务器                                        |

构建产物位于各包 `dist/`（web 为 `packages/web/dist/`，可直接静态部署）。
server 数据库默认写入 `packages/server/data/app.db`（`DB_PATH` 可覆盖），迁移文件在 `packages/server/drizzle/`。

## 手动冒烟测试（M3 全链路）

前置：Node ≥ 22.5；一个 OpenAI 兼容上游（如任何暴露 `/chat/completions` 的服务）与它的 API key。

1. **启动**：仓库根执行 `pnpm dev`——server 跑在 `http://localhost:3001`，web 跑在 `http://localhost:5173`（`/api` 自动代理到 3001）。
2. **导入一张测试卡**：打开 `http://localhost:5173`，在"链路探针"页选择一张 V2 PNG/JSON 角色卡 → 点"导入卡"，状态行显示"已导入：<卡名>"。没有现成卡时，可把 `packages/server/src/app.test.ts` 里的 `SAMPLE_CARD` JSON 存成 `.json` 文件使用。
3. **点"建会话"**：状态行显示"会话就绪"（卡片的 `first_mes` 会作为第一条 assistant 消息自动入库）。
4. **填上游配置**：任选一种方式向 `PUT /api/settings` 提交 `{ "baseUrl": "https://<上游>/v1", "apiKey": "<key>", "model": "<模型名>" }`（例如 `curl -X PUT http://localhost:3001/api/settings -H "content-type: application/json" -d '{"baseUrl":"...","apiKey":"...","model":"..."}'`）。
5. **发起对话**：在输入框输入消息 → 点"发送（SSE）"→ 黑色输出区**流式出字**（每个 delta 实时追加），结束时状态行显示"完成 ✓"。
6. **验证持久化**：`Ctrl+C` 停掉 `pnpm dev` → 再次 `pnpm dev` → 刷新页面重新"建会话"前，先 `curl http://localhost:3001/api/sessions/<id>`（id 见第 3 步响应或 `GET /api/sessions`）确认历史消息（含上一轮的 user 与 assistant 消息）**仍在**。

## 面向 Agent 的开发规则

见 [AGENTS.md](./AGENTS.md)——任何 Agent 在本仓库工作前必须先完整阅读 README、AGENTS.md 与 `docs/` 下全部文档。
