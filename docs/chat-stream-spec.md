# 流式聊天与消息状态规范

|          |                                                                                    |
| -------- | ---------------------------------------------------------------------------------- |
| 状态     | 已实现                                                                             |
| 适用范围 | `packages/server` 的 `/api/chat/stream`、`messages` 存储与 `packages/web` 聊天状态 |

## 1. 消息状态

`messages.status` 为 `pending` / `completed` / `failed` / `cancelled` 之一：

- `pending`：正常发送或重试已开始，正在等待上游完成。
- `completed`：手动创建的消息、历史消息与成功生成对应的用户消息；成功落库的 assistant 消息也始终为该状态。
- `failed`：组装或上游请求失败。
- `cancelled`：客户端断开导致上游请求被 abort。

迁移新增列的默认值为 `completed`，确保既有聊天记录保持可用。

## 2. 正常发送与重试

`POST /api/chat/stream` 接受以下互斥输入：

- 正常发送：`{ sessionId, content }`。服务端创建一条 `pending` 用户消息。
- 重试：`{ sessionId, messageId }`。仅允许目标为同一会话中 `failed` 或 `cancelled` 的用户消息；服务端复用该行并改回 `pending`，不得插入重复用户消息。群聊使用 `manual` 策略时还需带回本轮的 `speakerId`，以恢复原发言角色。
- 重新生成：`{ sessionId, regenerate: true }`。仅追加最后一条 assistant 消息的 swipe 候选，不改变用户消息状态。

流成功完成后，用户消息改为 `completed`；流错误改为 `failed`；客户端断开改为 `cancelled`。

`failed` 与 `cancelled` 消息不进入后续 prompt 组装。重试时该消息先恢复为 `pending`，再作为本轮历史的一部分参与组装。

群聊重新生成未显式指定 `speakerId` 时，服务端沿用目标 assistant 消息的发言角色；取消后重试由客户端带回原请求的 `speakerId`，且不新增用户消息。

## 3. SSE 事件

服务端固定按 `meta` → 零至多个 `delta` → `done` 或 `error` 输出。`meta` 含 `userMessageId`（重新生成时为 `null`）；`done` 含保存后的 assistant `messageId` 与完整 `content`；`error` 含 `code` 与可读 `message`。

客户端必须使用 `@another-tavern/sse` 解析 SSE，支持 LF/CRLF、跨 chunk、多行 `data:` 与 EOF 未收尾事件。
