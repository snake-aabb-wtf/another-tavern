/**
 * OpenAI 兼容上游客户端（M3 任务 §3）。
 * 流式读取 chat/completions 的 SSE，产出 content delta 字符串。
 */

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
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const delta = extractDelta(frame);
      if (delta !== null) {
        yield delta;
      }
      separator = buffer.indexOf("\n\n");
    }
  }
}

/** 从一帧 SSE 里提取 data: 载荷的 delta.content；[DONE] 返回 null 结束。 */
function extractDelta(frame: string): string | null {
  for (const rawLine of frame.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) {
      continue;
    }
    const payload = line.slice(5).trim();
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
  }
  return null;
}
