import { createServer } from "node:http";

const port = Number(process.env.E2E_UPSTREAM_PORT ?? 4010);

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404);
    response.end();
    return;
  }

  for await (const chunk of request) {
    // 消费请求体，模拟真实上游读取完整 JSON。
    void chunk;
  }

  response.writeHead(200, {
    "cache-control": "no-cache",
    "content-type": "text/event-stream",
    connection: "keep-alive",
  });
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "E2E " } }] })}\n\n`);
  response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "回复" } }] })}\n\n`);
  response.end("data: [DONE]\n\n");
});

server.listen(port, "127.0.0.1");

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
