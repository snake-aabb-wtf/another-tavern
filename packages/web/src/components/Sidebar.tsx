/** 左侧会话列表（桌面常驻，窄屏为抽屉内容）。 */
import { useSessionsStore } from "../stores/sessions.js";

export default function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const sessions = useSessionsStore((s) => s.sessions);
  const currentId = useSessionsStore((s) => s.currentId);
  const openSession = useSessionsStore((s) => s.openSession);
  const deleteSession = useSessionsStore((s) => s.deleteSession);

  return (
    <aside className="flex h-full flex-col bg-neutral-950">
      <div className="p-2">
        <button
          className="w-full rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
          onClick={onNavigate}
        >
          ＋ 新建会话（选角色卡）
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto pb-2">
        {sessions.map((s) => (
          <li key={s.id} className="group flex items-center px-2">
            <button
              className={`flex-1 truncate rounded px-2 py-1.5 text-left text-sm ${
                s.id === currentId
                  ? "bg-neutral-800 text-neutral-50"
                  : "text-neutral-300 hover:bg-neutral-900"
              }`}
              onClick={() => void openSession(s.id).then(onNavigate)}
              title={s.title || s.id}
            >
              {s.title || s.id.slice(0, 8)}
            </button>
            <button
              className="ml-1 hidden rounded px-1.5 py-1 text-xs text-neutral-500 hover:text-neutral-200 group-hover:block"
              aria-label="删除会话"
              onClick={() => void deleteSession(s.id)}
            >
              ✕
            </button>
          </li>
        ))}
        {sessions.length === 0 && <li className="p-3 text-xs text-neutral-500">还没有会话</li>}
      </ul>
    </aside>
  );
}
