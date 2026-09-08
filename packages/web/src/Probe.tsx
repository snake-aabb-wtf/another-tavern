/**
 * M3 抛弃式探针页：导入卡 → 建会话 → SSE 流式对话。
 * 仅用于手动验证全链路，正式前端在 M4 重做。
 */

import { useRef, useState } from "react";

export default function Probe() {
  const [characterId, setCharacterId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [draft, setDraft] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function importCard(): Promise<void> {
    const file = fileRef.current?.files?.[0];
    if (file === undefined) {
      setStatus("先选择一张 PNG/JSON 卡");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/characters/import", { method: "POST", body: form });
    const body = (await res.json()) as { id?: string; name?: string; error?: { message: string } };
    if (body.id === undefined) {
      setStatus(`导入失败：${body.error?.message ?? res.status}`);
      return;
    }
    setCharacterId(body.id);
    setStatus(`已导入：${body.name} (${body.id.slice(0, 8)}…)`);
  }

  async function createSession(): Promise<void> {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ characterId }),
    });
    const body = (await res.json()) as { id?: string; error?: { message: string } };
    if (body.id === undefined) {
      setStatus(`建会话失败：${body.error?.message ?? res.status}`);
      return;
    }
    setSessionId(body.id);
    setStatus(`会话就绪：${body.id.slice(0, 8)}…`);
  }

  async function send(): Promise<void> {
    if (sessionId === "" || draft === "" || busy) {
      return;
    }
    setBusy(true);
    setOutput("");
    setStatus("生成中…");
    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, content: draft }),
      });
      if (!res.body) {
        setStatus(`请求失败：${res.status}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let sep = buffer.indexOf("\n\n");
        while (sep !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = /event: (.+)/.exec(frame)?.[1] ?? "";
          const data = /data: (.+)/.exec(frame)?.[1] ?? "{}";
          const payload = JSON.parse(data) as { text?: string; message?: string };
          if (event === "delta" && typeof payload.text === "string") {
            setOutput((prev) => prev + payload.text);
          } else if (event === "done") {
            setStatus("完成 ✓");
          } else if (event === "error") {
            setStatus(`错误：${payload.message ?? "unknown"}`);
          }
          sep = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      setStatus(`连接中断：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const commonBtn = "rounded bg-neutral-100 px-3 py-1 text-sm text-neutral-900 disabled:opacity-40";

  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-3 p-6 text-neutral-100">
      <h2 className="text-lg font-semibold">链路探针（M3 临时页）</h2>
      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept=".png,.json" className="text-sm" />
        <button className={commonBtn} onClick={() => void importCard()}>
          导入卡
        </button>
        <button
          className={commonBtn}
          disabled={characterId === ""}
          onClick={() => void createSession()}
        >
          建会话
        </button>
      </div>
      <p className="text-xs text-neutral-400">
        characterId: {characterId || "—"} · sessionId: {sessionId || "—"}
      </p>
      <textarea
        className="h-20 rounded bg-neutral-800 p-2 text-sm"
        placeholder="输入消息…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button
        className={`${commonBtn} self-start`}
        disabled={busy || sessionId === "" || draft === ""}
        onClick={() => void send()}
      >
        发送（SSE）
      </button>
      <p className="text-xs text-neutral-400">{status}</p>
      <pre className="min-h-24 whitespace-pre-wrap rounded bg-neutral-800 p-3 text-sm">
        {output || "…"}
      </pre>
    </section>
  );
}
