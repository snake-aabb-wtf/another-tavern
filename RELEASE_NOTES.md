# Another Tavern v0.1.0

首个公开版本。开源、自托管优先的 AI 角色扮演框架，定位为 SillyTavern 的平替——核心是提示词组装引擎：把角色卡、用户人设、世界书、聊天历史在 token 预算内按规则组装成最终请求。

## 亮点

- **ST 角色卡导入**：V2（PNG 内嵌 JSON / JSON）与 V1 平铺卡；未知字段完整保留
- **提示词组装引擎**：固定段序 + 组装计划（槽位顺序/启停/自定义文本）、token 预算与裁剪（示例块 → 最旧历史 → 显式报错）、swipe 候选
- **世界书引擎**：主/副关键词（四种逻辑）、constant、扫描深度（全局/书/条目三级）、递归激活（步数上限）、逐书 token 预算竞争、深度注入
- **ST 资产导入**：预设 JSON → 组装计划；世界书 JSON → 引擎条目（未知字段保留）
- **流式对话**：OpenAI 兼容上游、SSE 逐 token、客户端断开自动 abort 上游
- **单容器/便携部署**：SQLite（node:sqlite）零外部数据库；Node 便携包与 Docker 镜像

## 下载

| 产物                               | 适用                                    | 用法                                                           |
| ---------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `another-tavern-v0.1.0-node22.zip` | 已装 Node ≥ 22.5 的 Windows/Linux/macOS | 解压后运行 `start.cmd`（Windows）或 `start.sh`，浏览器自动打开 |
| Docker 镜像 / Dockerfile           | 有 Docker 的环境                        | 见 README「Docker」节                                          |

## 快速开始（源码）

```bash
pnpm install
pnpm dev        # server:3001 + web:5173
```

## 已知限制（v0.1.0）

- 不支持：群聊、正则脚本、世界书正则 key、Timed Effects、Inclusion Group、向量检索、Outlet、作者注频率
- 世界书插入位置仅实现 beforeChar / afterChar / atDepth（其余可选但不注入，字段保留）
- API key 以明文存于本地 SQLite（`data/app.db`），请勿把该目录提交到任何仓库或分享给他人
- 分发为 Node 便携包（需 Node ≥ 22.5）；Bun 单文件编译待 v0.2 验证
- 语义化版本早期阶段：配置与 API 可能在不另行通知的情况下调整
