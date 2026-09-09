/** 左侧会话列表（桌面常驻，窄屏为抽屉内容）。 */
import { useSessionsStore } from "../stores/sessions.js";
import { sidebar as t } from "../ui-text.js";

export default function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const currentId = useSessionsStore((s) => s.currentId);
  const openSession = useSessionsStore((s) => s.openSession);
  const deleteSession = useSessionsStore((s) => s.deleteSession);

  return (
    <aside className="flex h-full flex-col bg-tavern-950">
      <div className="p-2">
        <button className="btn-secondary w-full" onClick={onNavigate}>
          {t.newSession}
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto pb-2">
        {sessions.map((s) => (
          <li key={s.id} className="group flex items-center px-2">
            <button
              className={`flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                s.id === currentId
                  ? "bg-tavern-800 text-candle-300"
                  : "text-ink-300 hover:bg-tavern-800"
              }`}
              onClick={() => void openSession(s.id).then(onNavigate)}
              title={s.title || s.id}
            >
              {s.title || s.id.slice(0, 8)}
            </button>
            <button
              className="btn-ghost-danger ml-1 hidden group-hover:block"
              aria-label={t.deleteSession}
              onClick={() => void deleteSession(s.id)}
            >
              ✕
            </button>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="p-3 text-center text-xs text-ink-400">{t.empty}</li>
        )}
      </ul>
    </aside>
  );
}
