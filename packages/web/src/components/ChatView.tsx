/** 聊天区：消息流式渲染、输入框、计划/世界书来源展示与切换、最终 prompt 查看。 */
import { useEffect, useRef, useState } from "react";

import { useLorebooksStore } from "../stores/lorebooks.js";
import { usePlansStore } from "../stores/plans.js";
import { useSessionsStore } from "../stores/sessions.js";
import { useSettingsStore } from "../stores/settings.js";
import { chat as t } from "../ui-text.js";
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
  const lorebookItems = useLorebooksStore((s) => s.items);
  const globalBooks = lorebookItems.filter((b) => b.isGlobal);
  const [showPrompt, setShowPrompt] = useState(false);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const session = sessions.find((s) => s.id === currentId);
  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id ?? null;

  // 当前生效计划名：会话级 > 全局默认 > 内置默认
  const effectivePlanId = session?.planId ?? settings?.defaultPlanId ?? null;
  const effectivePlanName =
    effectivePlanId === null
      ? t.builtinDefault
      : (plans.find((p) => p.id === effectivePlanId)?.name ?? effectivePlanId);
  void effectivePlanName; // 预留给计划详情浮层

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming?.text]);

  if (currentId === null) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-400">
        {t.pickSession}
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 text-xs text-ink-400">
        <span className="font-display text-sm text-ink-100">
          {session?.title || t.untitledSession}
        </span>
        <span className="flex items-center gap-1">
          {t.planLabel}
          <select
            className="input-base"
            value={session?.planId ?? ""}
            onChange={(e) => void setPlan(e.target.value === "" ? null : e.target.value)}
          >
            <option value="">
              {t.followGlobalDefault(
                settings?.defaultPlanId === null || settings?.defaultPlanId === undefined
                  ? t.builtinDefault
                  : (plans.find((p) => p.id === settings.defaultPlanId)?.name ?? "?"),
              )}
            </option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </span>
        <span>{t.loreSources(linkedBookIds.length, globalBooks.length)}</span>
        <button
          className="btn-ghost ml-auto"
          onClick={() => {
            void fetchLastPrompt();
            setShowPrompt((v) => !v);
          }}
        >
          {t.viewLastPrompt}
        </button>
      </div>

      {showPrompt && (
        <div className="max-h-60 space-y-2 overflow-y-auto border-b border-line bg-tavern-900/60 p-3">
          {lastPrompt === null ? (
            <p className="text-xs text-ink-500">{t.noPromptYet}</p>
          ) : (
            lastPrompt.messages.map((m, i) => (
              <div key={i} className="text-xs">
                <span className="mr-2 rounded-md bg-tavern-800 px-1.5 py-0.5 text-brass-400">
                  {m.role}
                </span>
                <span className="whitespace-pre-wrap text-ink-300">{m.content}</span>
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
            <div className="msg-enter max-w-[85%] whitespace-pre-wrap break-words rounded-lg border-l-2 border-brass-500 bg-parchment-100 px-4 py-3 text-sm text-inkwell-900 shadow-panel">
              {streaming.text === "" ? (
                <span className="inline-flex items-center gap-1.5 text-ink-500">
                  <span
                    className="breathe inline-block h-1.5 w-1.5 rounded-full bg-candle-400"
                    aria-hidden="true"
                  />
                  {t.streamingPlaceholder}
                </span>
              ) : (
                streaming.text
              )}
            </div>
          </div>
        )}
        {error !== null && <p className="text-xs text-ember-400">{error}</p>}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <textarea
          className="input-base h-16 flex-1 resize-none"
          placeholder={t.inputPlaceholder}
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
          className="btn-primary self-end"
          disabled={busy || draft.trim() === ""}
          onClick={submit}
        >
          {t.send}
        </button>
        <button
          className="btn-secondary self-end"
          disabled={busy}
          onClick={() => void regenerate()}
        >
          {t.regenerate}
        </button>
      </div>
    </div>
  );
}
