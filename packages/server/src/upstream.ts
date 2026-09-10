/**
 * OpenAI 兼容上游客户端（M3 任务 §3）。
 * 流式读取 chat/completions 的 SSE，产出 content delta 字符串。
 */

import { SseParser } from "@another-tavern/sse";

export class UpstreamError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(`Upstream responded ${status}: ${detail.slice(0, 300)}`);
    this.name = "UpstreamError";
    this.status = status;
    this.detail = detail;
  }
}

export interface UpstreamRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>;
  signal: AbortSignal;
  /** 采样参数等附加字段（白名单过滤后）原样并入请求体。 */
  extraBody?: Record<string, unknown>;
}

type FetchImpl = typeof fetch;

/** 请求上游并以 async generator 逐 delta 产出文本。 */
export async function* streamUpstreamCompletion(
  req: UpstreamRequest,
  fetchImpl: FetchImpl = globalThis.fetch,
): AsyncGenerator<string> {
  const url = `${req.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(req.apiKey !== "" ? { authorization: `Bearer ${req.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      stream: true,
      ...(req.extraBody ?? {}),
    }),
    signal: req.signal,
  });

  if (!response.ok || response.body === null) {
    const detail = await response.text().catch(() => "");
    throw new UpstreamError(response.status, detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
      const delta = extractDelta(frame.data);
      if (delta !== null) {
        yield delta;
      }
    }
  }
  for (const frame of [...parser.push(decoder.decode()), ...parser.finish()]) {
    const delta = extractDelta(frame.data);
    if (delta !== null) {
      yield delta;
    }
  }
}

/** 从 SSE data 载荷中提取 OpenAI delta.content；[DONE] 与心跳返回 null。 */
function extractDelta(payload: string): string | null {
  if (payload === "[DONE]") {
    return null;
  }
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = parsed.choices?.[0]?.delta?.content;
    if (typeof content === "string" && content !== "") {
      return content;
    }
  } catch {
    // 非 JSON 心跳/注释帧：忽略
  }
  return null;
}
