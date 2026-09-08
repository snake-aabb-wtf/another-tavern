/** 统一 fetch 封装：JSON 请求、结构化错误、multipart 上传、SSE 流读取。 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(path, init);
  if (!res.ok) {
    let code = "http_error";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error !== undefined) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
      }
    } catch {
      // 非 JSON 错误体：保留默认消息
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) {
    return null;
  }
  return (await res.json()) as unknown;
}

export const api = {
  get: (path: string): Promise<unknown> => request(path),
  post: (path: string, body?: unknown): Promise<unknown> =>
    request(path, {
      method: "POST",
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    }),
  put: (path: string, body: unknown): Promise<unknown> =>
    request(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  del: (path: string): Promise<unknown> => request(path, { method: "DELETE" }),
};

/** multipart 文件上传。 */
export async function uploadFile(path: string, file: File): Promise<unknown> {
  const form = new FormData();
  form.append("file", file);
  return request(path, { method: "POST", body: form });
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

/**
 * 读取 POST SSE 流并逐帧回调（fetch 流式；EventSource 不支持 POST）。
 * 返回累积的所有帧。
 */
export async function readSseStream(
  response: Response,
  onFrame: (frame: SseFrame) => void,
): Promise<SseFrame[]> {
  if (!resOk(response) || response.body === null) {
    throw new ApiError(
      response.status,
      "stream_failed",
      `流式请求失败（HTTP ${response.status}）。`,
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
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
      const parsed = parseFrame(frame);
      if (parsed !== null) {
        frames.push(parsed);
        onFrame(parsed);
      }
      separator = buffer.indexOf("\n\n");
    }
  }
  return frames;
}

function resOk(res: Response): boolean {
  return res.ok;
}

function parseFrame(frame: string): SseFrame | null {
  const event = /event: (.+)/.exec(frame)?.[1] ?? "message";
  const dataLine = /data: (.+)/.exec(frame)?.[1];
  if (dataLine === undefined) {
    return null;
  }
  try {
    return { event, data: JSON.parse(dataLine) as Record<string, unknown> };
  } catch {
    return null;
  }
}
