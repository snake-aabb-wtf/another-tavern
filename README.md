# Another Tavern

开源、自托管优先的 AI 角色扮演框架，定位为 [SillyTavern](https://github.com/SillyTavern/SillyTavern)（下称 ST）的平替。
核心价值在**提示词组装引擎**：把角色卡、用户人设、世界书（lorebook）、聊天历史在 token 预算内按规则组装成最终请求——UI 只是皮，引擎是灵魂。

## 当前状态

M0 脚手架已完成：pnpm workspace + 三个包骨架 + 工具链（TypeScript strict / vitest / eslint / prettier）。
**业务逻辑尚未开始**，当前唯一实现的 API 端点是 `GET /api/health`。

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

| 包                | 职责                                                                                                                            | 当前状态              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `packages/engine` | 无头引擎：角色卡（ST V2，PNG 内嵌 JSON）解析、世界书引擎、Prompt 组装器、tokenizer 接口。零 UI 依赖、不发网络请求、不碰数据库。 | 仅版本常量 + 冒烟测试 |
| `packages/server` | Hono API + SSE 流式 + SQLite 存储（Drizzle ORM），调用 engine。                                                                 | 仅 `GET /api/health`  |
| `packages/web`    | Vite + React + Tailwind SPA，只跟 server 通信。                                                                                 | 仅首页占位（项目名）  |

## 技术栈（锁定，不得替换）

- pnpm workspaces monorepo；TypeScript（strict 全开，根 `tsconfig.base.json` 统一继承）；vitest；eslint + prettier
- server：Hono + Drizzle ORM（SQLite）
- web：Vite + React + Tailwind（禁用 Next.js 与一切组件库）
- 运行时 Node ≥ 20，保持与 Bun 兼容（不使用 Bun 特有 API）

## 常用命令

| 命令                                    | 作用                                                |
| --------------------------------------- | --------------------------------------------------- |
| `pnpm install`                          | 安装依赖                                            |
| `pnpm build`                            | 依次构建全部包（engine → server → web，按拓扑顺序） |
| `pnpm test`                             | 运行全部 vitest 测试                                |
| `pnpm typecheck`                        | 对全部包运行 `tsc --noEmit`（含测试文件）           |
| `pnpm lint`                             | ESLint 检查全部源码                                 |
| `pnpm format`                           | Prettier 格式化（提交前先跑一遍）                   |
| `pnpm format:check`                     | Prettier 格式校验                                   |
| `pnpm --filter @another-tavern/web dev` | 启动 web 开发服务器                                 |

构建产物位于各包 `dist/`（web 为 `packages/web/dist/`，可直接静态部署）。

## 面向 Agent 的开发规则

见 [AGENTS.md](./AGENTS.md)——任何 Agent 在本仓库工作前必须先完整阅读 README、AGENTS.md 与 `docs/` 下全部文档。
