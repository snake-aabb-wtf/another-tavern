/** 世界书管理页：书列表 + 条目编辑器 + ST 导入 + 角色挂载 + 全局开关。 */
import { useEffect, useState } from "react";

import type { LorebookEntryData } from "../api/lorebooks.js";
import { statusTone } from "../status-tone.js";
import { useCharactersStore } from "../stores/characters.js";
import { useLorebooksStore } from "../stores/lorebooks.js";
import { app as ta, lorebooks as t } from "../ui-text.js";

export default function LorebooksPage() {
  const items = useLorebooksStore((s) => s.items);
  const current = useLorebooksStore((s) => s.current);
  const linkedCharacterIds = useLorebooksStore((s) => s.linkedCharacterIds);
  const lastImport = useLorebooksStore((s) => s.lastImport);
  const load = useLorebooksStore((s) => s.load);
  const open = useLorebooksStore((s) => s.open);
  const create = useLorebooksStore((s) => s.create);
  const updateBook = useLorebooksStore((s) => s.updateBook);
  const remove = useLorebooksStore((s) => s.remove);
  const importBook = useLorebooksStore((s) => s.importBook);
  const saveEntry = useLorebooksStore((s) => s.saveEntry);
  const removeEntry = useLorebooksStore((s) => s.removeEntry);
  const toggleCharacterLink = useLorebooksStore((s) => s.toggleCharacterLink);
  const characters = useCharactersStore((s) => s.items);
  const loadCharacters = useCharactersStore((s) => s.load);

  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingEntry, setEditingEntry] = useState<LorebookEntryData | null>(null);

  useEffect(() => {
    void load();
    void loadCharacters();
  }, [load, loadCharacters]);

  async function doImport(file: File, isGlobal: boolean): Promise<void> {
    setBusy(true);
    setStatus(t.importingStatus);
    try {
      await importBook(file, isGlobal);
      setStatus(t.importDone);
    } catch (e) {
      setStatus(`${t.importFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrentEntry(): Promise<void> {
    if (editingEntry === null) {
      return;
    }
    setBusy(true);
    try {
      await saveEntry(editingEntry.id, editingEntry);
      setStatus(t.entrySaved);
      setEditingEntry(null);
    } catch (e) {
      setStatus(`${t.saveFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左：书列表与导入 */}
      <div className="w-72 shrink-0 space-y-3 overflow-y-auto border-r border-line p-3">
        <h2 className="page-title px-1">{ta.pages.lorebooks}</h2>
        <div className="rounded-lg border-2 border-dashed border-line p-2 text-center text-xs text-ink-500">
          <label className="block cursor-pointer py-1 transition-colors hover:text-ink-300">
            {t.importSt}
            {busy ? t.importing : ""}
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) {
                  void doImport(file, false);
                  e.target.value = "";
                }
              }}
            />
          </label>
          <label className="block cursor-pointer border-t border-line py-1 transition-colors hover:text-ink-300">
            {t.importStGlobal}
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) {
                  void doImport(file, true);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </div>
        {status !== "" && (
          <p
            className={`text-xs ${statusTone(status, [t.importFailed, t.saveFailed], [t.importingStatus])}`}
          >
            {status}
          </p>
        )}
        {lastImport !== null && (
          <div className="rounded-lg border border-line p-2 text-xs text-ink-400">
            <p className="text-ink-100">
              {t.importSummary}
              {lastImport.name}
            </p>
            <p>{t.entryCount(lastImport.entryCount)}</p>
            {lastImport.warnings.length > 0 && (
              <p className="text-candle-400">{t.warningsKept(lastImport.warnings.length)}</p>
            )}
          </div>
        )}
        <button
          className="btn-secondary w-full"
          disabled={busy}
          onClick={() => {
            void create(t.autoName(new Date().toLocaleString())).then((id) => void open(id));
          }}
        >
          {t.newBook}
        </button>
        <ul className="space-y-1">
          {items.map((b) => (
            <li key={b.id}>
              <button
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  current?.id === b.id
                    ? "bg-tavern-800 text-candle-300"
                    : "text-ink-300 hover:bg-tavern-800"
                }`}
                onClick={() => void open(b.id)}
              >
                {b.isGlobal && <span className="mr-1 text-candle-400">{t.globalBadge}</span>}
                {b.name}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-3 text-center text-xs text-ink-400">{t.noBooks}</li>
          )}
        </ul>
      </div>

      {/* 右：选中书详情 */}
      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {current === null ? (
          <p className="m-auto text-sm text-ink-400">{t.pickBook}</p>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-4">
            <BookEditor />
            <CharacterLinks />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-100">
                {t.entries(current.entries.length)}
              </h3>
              <div className="flex gap-2">
                <button
                  className="btn-ghost-danger"
                  onClick={() => {
                    void remove(current.id);
                  }}
                >
                  {t.deleteBook}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => {
                    setEditingEntry(emptyEntry());
                  }}
                >
                  {t.newEntry}
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {current.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:border-candle-600/40 hover:bg-tavern-800"
                >
                  <span className={entry.enabled ? "" : "text-ink-500 line-through"}>
                    {entry.comment || entry.keys.join(", ") || entry.id}
                  </span>
                  {entry.constant && (
                    <span className="text-xs text-candle-400">{t.constantBadge}</span>
                  )}
                  <span className="ml-auto flex gap-2">
                    <button className="btn-ghost" onClick={() => setEditingEntry(entry)}>
                      {t.edit}
                    </button>
                    <button className="btn-ghost-danger" onClick={() => void removeEntry(entry.id)}>
                      {t.deleteEntry}
                    </button>
                  </span>
                </li>
              ))}
              {current.entries.length === 0 && (
                <li className="py-3 text-center text-xs text-ink-400">{t.noEntries}</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* 条目编辑弹层 */}
      {editingEntry !== null && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-tavern-950/70"
          onClick={() => setEditingEntry(null)}
        >
          <div
            className="panel-pop max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink-100">{t.entryEditor}</h3>
              <button
                className="btn-ghost"
                aria-label={t.close}
                onClick={() => setEditingEntry(null)}
              >
                ✕
              </button>
            </div>
            <div>
              <label className="label-base">{t.keys}</label>
              <input
                className="input-base w-full"
                value={editingEntry.keys.join(", ")}
                onChange={(e) =>
                  setEditingEntry({ ...editingEntry, keys: splitKeys(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label-base">{t.secondaryKeys}</label>
              <input
                className="input-base w-full"
                value={editingEntry.secondaryKeys.join(", ")}
                onChange={(e) =>
                  setEditingEntry({ ...editingEntry, secondaryKeys: splitKeys(e.target.value) })
                }
              />
            </div>
            <div>
              <label className="label-base">{t.content}</label>
              <textarea
                className="input-base h-24 w-full"
                value={editingEntry.content}
                onChange={(e) => setEditingEntry({ ...editingEntry, content: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-candle-500"
                  checked={editingEntry.constant}
                  onChange={(e) => setEditingEntry({ ...editingEntry, constant: e.target.checked })}
                />
                {t.constant}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-candle-500"
                  checked={editingEntry.enabled}
                  onChange={(e) => setEditingEntry({ ...editingEntry, enabled: e.target.checked })}
                />
                {t.enabled}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-candle-500"
                  checked={editingEntry.selective}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, selective: e.target.checked })
                  }
                />
                {t.useSecondary}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-candle-500"
                  checked={editingEntry.preventRecursion}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, preventRecursion: e.target.checked })
                  }
                />
                {t.preventRecursion}
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label-base">{t.insertionOrder}</label>
                <input
                  className="input-base w-full"
                  type="number"
                  value={editingEntry.insertionOrder}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, insertionOrder: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="label-base">{t.position}</label>
                <select
                  className="input-base w-full"
                  value={editingEntry.position}
                  onChange={(e) =>
                    setEditingEntry({
                      ...editingEntry,
                      position: e.target.value as LorebookEntryData["position"],
                    })
                  }
                >
                  <option value="beforeChar">{t.positions.beforeChar}</option>
                  <option value="afterChar">{t.positions.afterChar}</option>
                  <option value="atDepth">{t.positions.atDepth}</option>
                  <option value="anTop">{t.positions.anTop}</option>
                  <option value="anBottom">{t.positions.anBottom}</option>
                  <option value="beforeExample">{t.positions.beforeExample}</option>
                  <option value="afterExample">{t.positions.afterExample}</option>
                  <option value="outlet">{t.positions.outlet}</option>
                </select>
              </div>
              <div>
                <label className="label-base">{t.depth}</label>
                <input
                  className="input-base w-full"
                  type="number"
                  value={editingEntry.depth ?? 4}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, depth: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setEditingEntry(null)}>
                {t.cancel}
              </button>
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void saveCurrentEntry()}
              >
                {t.saveEntry}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function BookEditor(): React.JSX.Element | null {
    if (current === null) {
      return null;
    }
    return (
      <div className="panel space-y-2 p-3">
        <div>
          <label className="label-base">{t.bookName}</label>
          <input
            className="input-base w-full"
            defaultValue={current.name ?? ""}
            key={current.id}
            onBlur={(e) => {
              if (e.target.value.trim() !== "" && e.target.value !== current.name) {
                void updateBook(current.id, { name: e.target.value });
              }
            }}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="label-base">{t.tokenBudget}</label>
            <input
              className="input-base w-full"
              type="number"
              placeholder={t.tokenBudgetPlaceholder}
              defaultValue={current.tokenBudget ?? ""}
              onBlur={(e) => {
                const value = e.target.value === "" ? null : Number(e.target.value);
                void updateBook(current.id, { tokenBudget: value });
              }}
            />
          </div>
          <div>
            <label className="label-base">{t.scanDepth}</label>
            <input
              className="input-base w-full"
              type="number"
              placeholder={t.scanDepthPlaceholder}
              defaultValue={current.scanDepth ?? ""}
              onBlur={(e) => {
                const value = e.target.value === "" ? null : Number(e.target.value);
                void updateBook(current.id, { scanDepth: value });
              }}
            />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-candle-500"
                checked={current.isGlobal}
                onChange={(e) => void updateBook(current.id, { isGlobal: e.target.checked })}
              />
              {t.globalBook}
            </label>
          </div>
        </div>
      </div>
    );
  }

  function CharacterLinks(): React.JSX.Element | null {
    if (current === null || characters.length === 0) {
      return null;
    }
    return (
      <div className="panel p-3">
        <h3 className="mb-2 text-sm font-semibold text-ink-100">{t.mountTo}</h3>
        <div className="flex flex-wrap gap-3 text-sm">
          {characters.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="accent-candle-500"
                checked={linkedCharacterIds.includes(c.id)}
                onChange={() => void toggleCharacterLink(c.id)}
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>
    );
  }
}

function emptyEntry(): LorebookEntryData {
  return {
    id: "",
    comment: "",
    keys: [],
    secondaryKeys: [],
    selective: false,
    logic: "andAny",
    content: "",
    enabled: true,
    constant: false,
    insertionOrder: 100,
    position: "afterChar",
    depth: null,
    role: null,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    preventRecursion: false,
    excludeRecursion: false,
    extensions: {},
  };
}

function splitKeys(value: string): string[] {
  return value
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key !== "");
}
