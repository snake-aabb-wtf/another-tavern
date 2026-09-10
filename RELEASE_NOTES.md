# Another Tavern v0.3.0-beta.2

这是群聊核心链路的预览版本。Another Tavern 是开源、自托管优先的 AI 角色扮演框架，定位为 SillyTavern 的平替；核心是把角色卡、用户人设、世界书和聊天历史组装成最终请求。

## 本版本亮点

- **群聊会话**：创建包含多个角色的共享会话，保留成员顺序、静音状态和 talkativeness。
- **发言调度**：支持手动选择、按列表轮换和 `force` 强制静音角色发言；默认使用 Swap Prompt，避免无关角色卡同时占用上下文。
- **群聊前端**：新增群聊创建面板、成员设置面板、发言角色选择器和角色身份消息标识。
- **可靠流式生命周期**：群聊支持 SSE 生成、失败、取消、原消息重试、重新生成和并发保护。
- **完整验收覆盖**：新增从创建、成员设置、生成到刷新恢复的群聊 E2E 验收测试。
- **安全默认值**：服务默认只监听 `127.0.0.1`；需要局域网或容器访问时显式设置 `HOST=0.0.0.0`。
- **统一 SSE 解析**：支持 LF/CRLF、跨 chunk、多行 `data:`、注释、EOF 残留事件和 `[DONE]`。
- **便携部署**：GitHub Actions 会在标签构建通过后生成 Node 22 便携包，并验证 Docker 构建与健康检查。

## 验证结果

发布前已通过：

- `pnpm build`
- `pnpm test`：238 个测试全部通过
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`

群聊自动化与浏览器冒烟验收清单见 [docs/group-chat-e2e.md](./docs/group-chat-e2e.md)。

## 已知限制

- **不支持自动多轮**：用户发送一条消息后，本版本只生成一轮 assistant 回复，不会自动让多个角色连续接话。
- 浏览器视觉冒烟需要本机安装 Playwright 浏览器运行时；请使用脱敏测试数据执行 `python scripts/screenshot.py`。
- 不支持正则脚本、世界书正则 key、Timed Effects、Inclusion Group、向量检索、Outlet、作者注频率。
- 世界书插入位置仅实现 `beforeChar` / `afterChar` / `atDepth`，其余字段保留但不注入。
- API key 以明文存于本地 SQLite（`data/app.db`），请勿把该目录提交或分享。
- 需要 Node ≥ 22.5；Bun 单文件编译仍未实现。

## 下载

| 产物                                      | 适用                                      | 用法                                           |
| ----------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| `another-tavern-v0.3.0-beta.2-node22.zip` | 已安装 Node ≥ 22.5 的 Windows/Linux/macOS | 解压后运行 `start.cmd`（Windows）或 `start.sh` |
| Docker 镜像 / Dockerfile                  | 有 Docker 的环境                          | 见 README「Docker」节                          |

## 快速开始（源码）

```bash
pnpm install
pnpm dev        # server:3001 + web:5173
```
