/** 聊天区：消息流式渲染、输入框、计划/世界书来源展示与切换、最终 prompt 查看。 */
import { useEffect, useRef, useState } from "react";

import { useLorebooksStore } from "../stores/lorebooks.js";
import { usePlansStore } from "../stores/plans.js";
import { useSessionsStore } from "../stores/sessions.js";
import { useSettingsStore } from "../stores/settings.js";
import MessageItem from "./MessageItem.js";

export default function ChatView() {
  const sessions = useSessionsStore((s) => s.sessions);
  const currentId = useSessionsStore((s) => s.currentId);
  const linkedBookIds = useSessionsStore((s) => s.linkedBookIds);
  const messages = useSessionsStore((s) => s.messages);
  const streaming = useSessionsStore((s) => s.streaming);
  const error = useSessionsStore((s) => s.error);
  const send = useSessionsStore((s) => s.send);
  const regenerate = useSessionsStore((s) => s.regenerate);
  const setPlan = useSessionsStore((s) => s.setPlan);
  const fetchLastPrompt = useSessionsStore((s) => s.fetchLastPrompt);
  const lastPrompt = useSessionsStore((s) => s.lastPrompt);
  const plans = usePlansStore((s) => s.items);
  const settings = useSettingsStore((s) => s.settings);
  const globalBooks = useLorebooksStore((s) => s.items.filter((b) => b.isGlobal));
  const [showPrompt, setShowPrompt] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === currentId);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  // 当前生效计划名：会话级 > 全局默认 > 内置默认
  const effectivePlanId = session?.planId ?? settings?.defaultPlanId ?? null;
  const effectivePlanName =
    effectivePlanId === null
      ? "内置默认"
      : (plans.find((p) => p.id === effectivePlanId)?.name ?? effectivePlanId);
  void effectivePlanName; // 预留给计划详情浮层

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-800 px-4 py-2 text-xs text-neutral-400">
        <span className="text-sm text-neutral-200">{session?.title || "会话"}</span>
        <span className="flex items-center gap-1">
          计划：
          <select
            className="rounded bg-neutral-900 px-1 py-0.5 text-xs"
            value={session?.planId ?? ""}
            onChange={(e) => void setPlan(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">
              全局默认（
              {settings?.defaultPlanId === null || settings?.defaultPlanId === undefined
                ? "内置默认"
                : (plans.find((p) => p.id === settings.defaultPlanId)?.name ?? "?")}
              ）
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </span>
        <span>
          世界书：卡内 + 挂载 {linkedBookIds.length} · 全局 {globalBooks.length}
        </span>
        <button
          className="ml-auto rounded px-2 py-0.5 hover:bg-neutral-800 hover:text-neutral-200"
          onClick={() => {
            void fetchLastPrompt();
            setShowPrompt((v) => !v);
          }}
        >
          查看本次最终 prompt
        </button>
      </div>

      {showPrompt && (
        <div className="max-h-60 space-y-2 overflow-y-auto border-b border-neutral-800 bg-neutral-900/60 p-3">
          {lastPrompt === null ? (
            <p className="text-xs text-neutral-500">
              尚未组装（发送一条消息后这里显示最终 prompt）。
            </p>
          ) : (
            lastPrompt.messages.map((m, i) => (
              <div key={i} className="text-xs">
                <span className="mr-2 rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  {m.role}
                </span>
                <span className="whitespace-pre-wrap text-neutral-300">{m.content}</span>
              </div>
            ))
          )}
        </div>
      )}

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
