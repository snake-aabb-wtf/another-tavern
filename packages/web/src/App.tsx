/**
 * 应用布局：顶部页签 + 会话侧栏（桌面常驻 / 窄屏抽屉）+ 主内容区。
 */

import { useEffect, useState } from "react";

import CharactersPage from "./components/CharactersPage.js";
import ChatView from "./components/ChatView.js";
import LorebooksPage from "./components/LorebooksPage.js";
import PlansPage from "./components/PlansPage.js";
import RegexPage from "./components/RegexPage.js";
import SettingsPage from "./components/SettingsPage.js";
import Sidebar from "./components/Sidebar.js";
import { app as t } from "./ui-text.js";
import { useCharactersStore } from "./stores/characters.js";
import { useLorebooksStore } from "./stores/lorebooks.js";
import { usePlansStore } from "./stores/plans.js";
import { useSettingsStore } from "./stores/settings.js";
import { useSessionsStore } from "./stores/sessions.js";

type Page = "chat" | "characters" | "lorebooks" | "plans" | "regex" | "settings";

const PAGE_LABELS: ReadonlyArray<readonly [Page, string]> = [
  ["chat", t.pages.chat],
  ["characters", t.pages.characters],
  ["lorebooks", t.pages.lorebooks],
  ["plans", t.pages.plans],
  ["regex", t.pages.regex],
  ["settings", t.pages.settings],
];

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [drawer, setDrawer] = useState(false);
  const loadSessions = useSessionsStore((s) => s.loadSessions);
  const loadCharacters = useCharactersStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const loadPlans = usePlansStore((s) => s.load);
  const loadLorebooks = useLorebooksStore((s) => s.load);

  useEffect(() => {
    void loadSessions();
    void loadCharacters();
    void loadSettings();
    void loadPlans();
    void loadLorebooks();
  }, [loadSessions, loadCharacters, loadSettings, loadPlans, loadLorebooks]);

  return (
    <div className="flex h-screen flex-col text-ink-100">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <button
          className="rounded-md p-1 text-ink-300 transition-colors hover:bg-tavern-800 hover:text-ink-100 md:hidden"
          aria-label={t.openSidebar}
          onClick={() => setDrawer(true)}
        >
          ☰
        </button>
        <h1 className="flex items-center gap-2 font-display text-lg tracking-wide">
          {/* 烛焰：全场唯一签名图标（inline SVG，无依赖） */}
          <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0" aria-hidden="true">
            <path
              className="fill-candle-400"
              d="M8 1.8c2.1 2.9 3.2 4.6 3.2 6.4a3.2 3.2 0 1 1-6.4 0C4.8 6.4 5.9 4.7 8 1.8Z"
            />
            <path
              className="fill-candle-300"
              d="M8 6.4c.9 1.3 1.4 2 1.4 2.9a1.4 1.4 0 1 1-2.8 0c0-.9.5-1.6 1.4-2.9Z"
            />
          </svg>
          {t.title}
        </h1>
        <nav className="ml-auto flex gap-1 text-sm">
          {PAGE_LABELS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={
                page === id
                  ? "rounded-t-md border-b-2 border-candle-300 px-3 py-1 text-candle-300 transition-colors"
                  : "rounded-t-md border-b-2 border-transparent px-3 py-1 text-ink-400 transition-colors hover:text-ink-300"
              }
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        {/* 桌面常驻侧栏 */}
        <div className="hidden w-64 shrink-0 border-r border-line md:block">
          <Sidebar onNavigate={() => setPage("chat")} />
        </div>

        {/* 窄屏抽屉 */}
        {drawer && (
          <div className="fixed inset-0 z-10 md:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-tavern-950/70" />
            <div
              className="absolute inset-y-0 left-0 w-64 border-r border-line bg-tavern-950 shadow-pop"
              onClick={(e) => e.stopPropagation()}
            >
              <Sidebar
                onNavigate={() => {
                  setPage("chat");
                  setDrawer(false);
                }}
              />
            </div>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-hidden">
          {page === "chat" && <ChatView />}
          {page === "characters" && <CharactersPage onGoChat={() => setPage("chat")} />}
          {page === "lorebooks" && <LorebooksPage />}
          {page === "plans" && <PlansPage />}
          {page === "regex" && <RegexPage />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
