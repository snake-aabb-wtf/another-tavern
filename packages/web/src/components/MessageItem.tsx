/** 单条消息气泡：编辑、swipe 切换、重新生成。 */
import { useState } from "react";

import type { ChatMessageRow } from "../api/sessions.js";
import { useSessionsStore } from "../stores/sessions.js";
import { chat as t, messageItem as ti } from "../ui-text.js";

interface Props {
  message: ChatMessageRow;
  isLastAssistant: boolean;
}

export default function MessageItem({ message, isLastAssistant }: Props) {
  const editMessage = useSessionsStore((s) => s.editMessage);
  const swipeTo = useSessionsStore((s) => s.swipeTo);
  const regenerate = useSessionsStore((s) => s.regenerate);
  const retryMessage = useSessionsStore((s) => s.retryMessage);
  const streaming = useSessionsStore((s) => s.streaming);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const isAssistant = message.role === "assistant";
  const candidateCount = message.swipeCandidates.length;
  const busy = streaming !== null;
  const pending = !isAssistant && message.status === "pending";
  const retryable = !isAssistant && (message.status === "failed" || message.status === "cancelled");

  return (
    <div className={`flex flex-col ${isAssistant ? "items-start" : "items-end"}`}>
      {isAssistant ? (
        <div className="max-w-[85%]">
          {message.speakerName && (
            <div className="mb-1 px-1 text-xs text-brass-400">{message.speakerName}</div>
          )}
          <div className="msg-enter whitespace-pre-wrap break-words rounded-lg border-l-2 border-brass-500 bg-parchment-100 px-4 py-3 text-sm text-inkwell-900 shadow-panel">
            {editing ? (
              <textarea
                autoFocus
                className="min-h-20 w-72 rounded-md border border-brass-500/40 bg-parchment-100 px-2.5 py-1.5 text-sm text-inkwell-900 outline-none focus:border-brass-500"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              message.content
            )}
          </div>
        </div>
      ) : (
        <div className="msg-enter max-w-[85%] whitespace-pre-wrap break-words rounded-lg border border-candle-600/40 bg-tavern-800 px-4 py-3 text-sm text-ink-100">
          {editing ? (
            <textarea
              autoFocus
              className="input-base min-h-20 w-72"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          ) : (
            message.content
          )}
        </div>
      )}
      <div className="mt-1 flex h-6 items-center gap-2 text-xs text-ink-500">
        {editing ? (
          <>
            <button
              className="btn-ghost"
              onClick={() => {
                void editMessage(message.id, draft).then(() => setEditing(false));
              }}
            >
              {t.save}
            </button>
            <button
              className="btn-ghost"
              onClick={() => {
                setDraft(message.content);
                setEditing(false);
              }}
            >
              {t.cancel}
            </button>
          </>
        ) : (
          <>
            <button
              className="btn-ghost"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              {t.edit}
            </button>
            {pending && <span className="text-candle-300">{ti.pending}</span>}
            {retryable && (
              <>
                <span className={message.status === "failed" ? "text-ember-400" : "text-ink-400"}>
                  {message.status === "failed" ? ti.failed : ti.cancelled}
                </span>
                <button
                  className="btn-ghost"
                  disabled={busy}
                  onClick={() => void retryMessage(message.id)}
                >
                  {ti.retry}
                </button>
              </>
            )}
            {isAssistant && candidateCount > 0 && (
              <span className="flex items-center gap-1">
                <button
                  className="btn-ghost"
                  aria-label={ti.prevCandidate}
                  disabled={message.swipeIndex <= 0 || busy}
                  onClick={() => void swipeTo(message.id, message.swipeIndex - 1)}
                >
                  ←
                </button>
                <span>
                  {message.swipeIndex + 1}/{candidateCount}
                </span>
                {isLastAssistant && message.swipeIndex >= candidateCount - 1 ? (
                  <button
                    className="btn-ghost"
                    aria-label={ti.newCandidate}
                    disabled={busy}
                    onClick={() => void regenerate()}
                  >
                    → {t.regenerate}
                  </button>
                ) : (
                  <button
                    className="btn-ghost"
                    aria-label={ti.nextCandidate}
                    disabled={message.swipeIndex >= candidateCount - 1 || busy}
                    onClick={() => void swipeTo(message.id, message.swipeIndex + 1)}
                  >
                    →
                  </button>
                )}
              </span>
            )}
            {isAssistant && isLastAssistant && candidateCount <= 1 && (
              <button className="btn-ghost" disabled={busy} onClick={() => void regenerate()}>
                {t.regenerate}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
