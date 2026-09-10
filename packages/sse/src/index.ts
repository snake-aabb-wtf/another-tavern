/** 一条已完成解析的 Server-Sent Event。 */
export interface SseEvent {
  /** 未指定时按 SSE 规范取 `message`。 */
  event: string;
  /** 所有 `data:` 行以换行符连接后的原始载荷。 */
  data: string;
}

/**
 * 增量解析 UTF-8 解码后的 SSE 文本。
 *
 * 支持 LF / CRLF 分隔、跨 chunk 字段、多行 `data:`、注释与流结束时的残留事件。
 * 字节到文本的解码由调用方负责，以便浏览器和 Node 复用本解析器。
 */
export class SseParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private hasData = false;

  /** 输入下一段已解码文本，并返回其中已完成的事件。 */
  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const rawLine = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const event = this.processLine(rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine);
      if (event !== null) {
        events.push(event);
      }
      newline = this.buffer.indexOf("\n");
    }
    return events;
  }

  /** 在流结束时刷新解码器剩余文本及未以空行收尾的事件。 */
  finish(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer !== "") {
      const rawLine = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
      const event = this.processLine(rawLine);
      if (event !== null) {
        events.push(event);
      }
      this.buffer = "";
    }
    const event = this.dispatch();
    if (event !== null) {
      events.push(event);
    }
    return events;
  }

  private processLine(line: string): SseEvent | null {
    if (line === "") {
      return this.dispatch();
    }
    if (line.startsWith(":")) {
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? "" : line.slice(colon + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") {
      this.eventName = value;
    } else if (field === "data") {
      this.dataLines.push(value);
      this.hasData = true;
    }
    return null;
  }

  private dispatch(): SseEvent | null {
    if (!this.hasData) {
      this.eventName = "";
      return null;
    }
    const event = {
      event: this.eventName === "" ? "message" : this.eventName,
      data: this.dataLines.join("\n"),
    };
    this.eventName = "";
    this.dataLines = [];
    this.hasData = false;
    return event;
  }
}
