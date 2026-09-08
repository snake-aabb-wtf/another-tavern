/** 单条消息气泡：编辑、swipe 切换、重新生成。 */
import { useState } from "react";

import type { ChatMessageRow } from "../api/sessions.js";
import { useSessionsStore } from "../stores/sessions.js";

interface Props {
  message: ChatMessageRow;
  isLastAssistant: boolean;
}

export default function MessageItem({ message, isLastAssistant }: Props) {
  const editMessage = useSessionsStore((s) => s.editMessage);
  const swipeTo = useSessionsStore((s) => s.swipeTo);
  const regenerate = useSessionsStore((s) => s.regenerate);
  const streaming = useSessionsStore((s) => s.streaming);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const isAssistant = message.role === "assistant";
  const candidateCount = message.swipeCandidates.length;
  const busy = streaming !== null;

  return (
    <div className={`flex flex-col ${isAssistant ? "items-start" : "items-end"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
          isAssistant ? "bg-neutral-800 text-neutral-100" : "bg-blue-800 text-blue-50"
        }`}
      >
        {editing ? (
          <textarea
            autoFocus
            className="min-h-20 w-72 rounded bg-neutral-900 p-2 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        ) : (
          message.content
        )}
      </div>
      <div className="mt-1 flex h-6 items-center gap-2 text-xs text-neutral-500">
        {editing ? (
          <>
            <button
              className="rounded px-2 py-0.5 hover:bg-neutral-800 hover:text-neutral-200"
              onClick={() => {
                void editMessage(message.id, draft).then(() => setEditing(false));
              }}
            >
              保存
            </button>
            <button
              className="rounded px-2 py-0.5 hover:bg-neutral-800 hover:text-neutral-200"
              onClick={() => {
                setDraft(message.content);
                setEditing(false);
              }}
            >
              取消
            </button>
          </>
        ) : (
          <>
            <button
              className="hover:text-neutral-200"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              编辑
            </button>
            {isAssistant && candidateCount > 0 && (
              <span className="flex items-center gap-1">
                <button
                  className="disabled:opacity-30"
                  aria-label="上一个候选"
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
                    className="disabled:opacity-30"
                    aria-label="生成新候选"
                    disabled={busy}
                    onClick={() => void regenerate()}
                  >
                    → 重新生成
                  </button>
                ) : (
                  <button
                    className="disabled:opacity-30"
                    aria-label="下一个候选"
                    disabled={message.swipeIndex >= candidateCount - 1 || busy}
                    onClick={() => void swipeTo(message.id, message.swipeIndex + 1)}
                  >
                    →
                  </button>
                )}
              </span>
            )}
            {isAssistant && isLastAssistant && candidateCount <= 1 && (
              <button
                className="disabled:opacity-30"
                disabled={busy}
                onClick={() => void regenerate()}
              >
                重新生成
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
