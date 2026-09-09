/**
 * 应用布局：顶部页签 + 会话侧栏（桌面常驻 / 窄屏抽屉）+ 主内容区。
 */

import { useEffect, useState } from "react";

import CharactersPage from "./components/CharactersPage.js";
import ChatView from "./components/ChatView.js";
import LorebooksPage from "./components/LorebooksPage.js";
import PlansPage from "./components/PlansPage.js";
import SettingsPage from "./components/SettingsPage.js";
import Sidebar from "./components/Sidebar.js";
import { app as t } from "./ui-text.js";
import { useCharactersStore } from "./stores/characters.js";
import { useLorebooksStore } from "./stores/lorebooks.js";
import { usePlansStore } from "./stores/plans.js";
import { useSettingsStore } from "./stores/settings.js";
import { useSessionsStore } from "./stores/sessions.js";

type Page = "chat" | "characters" | "lorebooks" | "plans" | "settings";

const PAGE_LABELS: ReadonlyArray<readonly [Page, string]> = [
  ["chat", t.pages.chat],
  ["characters", t.pages.characters],
  ["lorebooks", t.pages.lorebooks],
  ["plans", t.pages.plans],
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
    <div className="flex h-screen flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2">
        <button
          className="rounded p-1 hover:bg-neutral-800 md:hidden"
          aria-label={t.openSidebar}
          onClick={() => setDrawer(true)}
        >
          ☰
        </button>
        <h1 className="text-lg font-semibold tracking-tight">{t.title}</h1>
        <nav className="ml-auto flex gap-1 text-sm">
          {PAGE_LABELS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={
                page === id
                  ? "rounded bg-neutral-800 px-3 py-1"
                  : "rounded px-3 py-1 text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              }
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="relative flex flex-1 overflow-hidden">
        {/* 桌面常驻侧栏 */}
        <div className="hidden w-64 shrink-0 border-r border-neutral-800 md:block">
          <Sidebar onNavigate={() => setPage("chat")} />
        </div>

        {/* 窄屏抽屉 */}
        {drawer && (
          <div className="fixed inset-0 z-10 md:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <div
              className="absolute inset-y-0 left-0 w-64 border-r border-neutral-800 bg-neutral-950"
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
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
