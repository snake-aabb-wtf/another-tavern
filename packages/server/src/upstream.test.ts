import { describe, expect, it, vi } from "vitest";

import { streamUpstreamCompletion } from "./upstream.js";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("streamUpstreamCompletion", () => {
  it("接受 CRLF、跨 chunk 与 EOF 残留帧", async () => {
    const first = JSON.stringify({ choices: [{ delta: { content: "你" } }] });
    const last = JSON.stringify({ choices: [{ delta: { content: "好" } }] });
    const fetchImpl = vi.fn(async () =>
      sseResponse([`data: ${first}\r\n\r`, `\ndata: ${last}`]),
    ) as unknown as typeof fetch;

    const output: string[] = [];
    for await (const delta of streamUpstreamCompletion(
      {
        baseUrl: "http://upstream.test/v1",
        apiKey: "",
        model: "test-model",
        messages: [],
        signal: new AbortController().signal,
      },
      fetchImpl,
    )) {
      output.push(delta);
    }

    expect(output).toEqual(["你", "好"]);
  });
});
