/** 流式对话 API：POST /api/chat/stream 的 SSE 读取。 */
import { ApiError, readSseStream, type SseFrame } from "./client.js";

export interface StreamHandlers {
  onDelta?: (text: string) => void;
  onMeta?: (data: Record<string, unknown>) => void;
  onError?: (message: string) => void;
}

export interface StreamInput {
  sessionId: string;
  /** 正常发送时必填；regenerate 时忽略。 */
  content?: string;
  regenerate?: boolean;
}

/** 发起流式对话；返回完整回复文本。 */
export async function streamChat(
  input: StreamInput,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<{ content: string }> {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    ...(signal !== undefined ? { signal } : {}),
  });
  const frames = await readSseStream(res, (frame: SseFrame) => {
    if (frame.event === "delta" && typeof frame.data.text === "string") {
      handlers.onDelta?.(frame.data.text);
    } else if (frame.event === "meta") {
      handlers.onMeta?.(frame.data);
    } else if (frame.event === "error") {
      handlers.onError?.(typeof frame.data.message === "string" ? frame.data.message : "未知错误");
    }
  });
  const errorFrame = frames.find((f) => f.event === "error");
  if (errorFrame !== undefined) {
    throw new ApiError(
      200,
      typeof errorFrame.data.code === "string" ? errorFrame.data.code : "stream_error",
      String(errorFrame.data.message ?? "生成失败"),
    );
  }
  const doneFrame = frames.find((f) => f.event === "done");
  return {
    content: typeof doneFrame?.data.content === "string" ? doneFrame.data.content : "",
  };
}
