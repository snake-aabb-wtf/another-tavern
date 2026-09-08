/** 聊天区：消息流式渲染、输入框。 */
import { useEffect, useRef, useState } from "react";

import { useSessionsStore } from "../stores/sessions.js";
import MessageItem from "./MessageItem.js";

export default function ChatView() {
  const sessions = useSessionsStore((s) => s.sessions);
  const currentId = useSessionsStore((s) => s.currentId);
  const messages = useSessionsStore((s) => s.messages);
  const streaming = useSessionsStore((s) => s.streaming);
  const error = useSessionsStore((s) => s.error);
  const send = useSessionsStore((s) => s.send);
  const regenerate = useSessionsStore((s) => s.regenerate);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === currentId);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming?.text]);

  if (currentId === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">
        从左侧选择一个会话，或在「角色卡」页新建会话。
      </div>
    );
  }

  const busy = streaming !== null;
  const submit = (): void => {
    if (busy || draft.trim() === "") {
      return;
    }
    const content = draft;
    setDraft("");
    void send(content);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 px-4 py-2 text-sm text-neutral-400">
        {session?.title || "会话"}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageItem key={m.id} message={m} isLastAssistant={m.id === lastAssistantId} />
        ))}
        {streaming !== null && (
          <div className="flex flex-col items-start">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
              {streaming.text || "…"}
            </div>
          </div>
        )}
        {error !== null && <p className="text-xs text-red-400">{error}</p>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-neutral-800 p-3">
        <textarea
          className="h-16 flex-1 resize-none rounded bg-neutral-900 p-2 text-sm outline-none ring-neutral-700 focus:ring-1"
          placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="self-end rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-600 disabled:opacity-40"
          disabled={busy || draft.trim() === ""}
          onClick={submit}
        >
          发送
        </button>
        <button
          className="self-end rounded bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-40"
          disabled={busy}
          onClick={() => void regenerate()}
        >
          重新生成
        </button>
      </div>
    </div>
  );
}
