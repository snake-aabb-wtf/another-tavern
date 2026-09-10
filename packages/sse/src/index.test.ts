import { describe, expect, it } from "vitest";

import { SseParser } from "./index.js";

describe("SseParser", () => {
  it("解析 CRLF 分隔的多个事件", () => {
    const parser = new SseParser();
    expect(parser.push("event: delta\r\ndata: one\r\n\r\ndata: two\r\n\r\n")).toEqual([
      { event: "delta", data: "one" },
      { event: "message", data: "two" },
    ]);
  });

  it("处理恰好在 CRLF 边界断开的 chunk", () => {
    const parser = new SseParser();
    expect(parser.push("event: delta\r")).toEqual([]);
    expect(parser.push("\ndata: split\r\n\r")).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "delta", data: "split" }]);
  });

  it("忽略注释并按规范合并多行 data", () => {
    const parser = new SseParser();
    expect(parser.push(": heartbeat\nevent: note\ndata: first\ndata: second\n\n")).toEqual([
      { event: "note", data: "first\nsecond" },
    ]);
  });

  it("在 EOF 刷出没有空行收尾的事件", () => {
    const parser = new SseParser();
    expect(parser.push("data: final")).toEqual([]);
    expect(parser.finish()).toEqual([{ event: "message", data: "final" }]);
  });
});
