/** 世界书管理页：书列表 + 条目编辑器 + ST 导入 + 角色挂载 + 全局开关。 */
import { useEffect, useState } from "react";

import type { LorebookEntryData } from "../api/lorebooks.js";
import { useCharactersStore } from "../stores/characters.js";
import { useLorebooksStore } from "../stores/lorebooks.js";

const input =
  "w-full rounded bg-neutral-900 p-2 text-sm outline-none ring-neutral-700 focus:ring-1";
const label = "mb-1 block text-xs text-neutral-400";
const btn = "rounded px-3 py-1.5 text-sm disabled:opacity-40";

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
    setStatus("导入中…");
    try {
      await importBook(file, isGlobal);
      setStatus("导入完成 ✓（摘要见下方）");
    } catch (e) {
      setStatus(`导入失败：${e instanceof Error ? e.message : String(e)}`);
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
      setStatus("条目已保存 ✓");
      setEditingEntry(null);
    } catch (e) {
      setStatus(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左：书列表与导入 */}
      <div className="w-72 shrink-0 space-y-3 overflow-y-auto border-r border-neutral-800 p-3">
        <div className="rounded border border-dashed border-neutral-700 p-2 text-center text-xs text-neutral-500">
          <label className="block cursor-pointer py-1 hover:text-neutral-300">
            导入 ST 世界书 JSON{busy ? "（处理中…）" : ""}
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
          <label className="block cursor-pointer border-t border-neutral-800 py-1 hover:text-neutral-300">
            导入并设为全局
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
        {status !== "" && <p className="text-xs text-neutral-400">{status}</p>}
        {lastImport !== null && (
          <div className="rounded border border-neutral-800 p-2 text-xs text-neutral-400">
            <p className="text-neutral-200">导入摘要：{lastImport.name}</p>
            <p>条目数：{lastImport.entryCount}</p>
            {lastImport.warnings.length > 0 && (
              <p className="text-amber-400">
                警告 {lastImport.warnings.length} 条（未知字段已保留）
              </p>
            )}
          </div>
        )}
        <button
          className={`${btn} w-full bg-neutral-800 hover:bg-neutral-700`}
          disabled={busy}
          onClick={() => {
            void create(`世界书 ${new Date().toLocaleString()}`).then((id) => void open(id));
          }}
        >
          ＋ 新建世界书
        </button>
        <ul className="space-y-1">
          {items.map((b) => (
            <li key={b.id}>
              <button
                className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                  current?.id === b.id ? "bg-neutral-800" : "hover:bg-neutral-900"
                }`}
                onClick={() => void open(b.id)}
              >
                {b.isGlobal && <span className="mr-1 text-amber-400">[全局]</span>}
                {b.name}
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="text-xs text-neutral-500">还没有世界书</li>}
        </ul>
      </div>

      {/* 右：选中书详情 */}
      <div className="flex-1 overflow-y-auto p-4">
        {current === null ? (
          <p className="text-sm text-neutral-500">从左侧选择或导入一本世界书。</p>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            <BookEditor />
            <CharacterLinks />
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">条目（{current.entries.length}）</h3>
              <div className="flex gap-2">
                <button
                  className="text-xs text-red-400 hover:text-red-300"
                  onClick={() => {
                    void remove(current.id);
                  }}
                >
                  删除本书
                </button>
                <button
                  className={`${btn} bg-neutral-800 hover:bg-neutral-700`}
                  onClick={() => {
                    setEditingEntry(emptyEntry());
                  }}
                >
                  ＋ 新建条目
                </button>
              </div>
            </div>
            <ul className="space-y-1">
              {current.entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center gap-2 rounded border border-neutral-800 px-3 py-2 text-sm"
                >
                  <span className={entry.enabled ? "" : "text-neutral-600 line-through"}>
                    {entry.comment || entry.keys.join(", ") || entry.id}
                  </span>
                  {entry.constant && <span className="text-xs text-amber-400">常驻</span>}
                  <span className="ml-auto flex gap-2">
                    <button
                      className="text-xs hover:text-neutral-200"
                      onClick={() => setEditingEntry(entry)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-xs text-neutral-500 hover:text-red-400"
                      onClick={() => void removeEntry(entry.id)}
                    >
                      删除
                    </button>
                  </span>
                </li>
              ))}
              {current.entries.length === 0 && (
                <li className="text-xs text-neutral-500">暂无条目</li>
              )}
            </ul>
          </div>
        )}
      </div>

      {/* 条目编辑弹层 */}
      {editingEntry !== null && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/60"
          onClick={() => setEditingEntry(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg space-y-3 overflow-y-auto rounded border border-neutral-700 bg-neutral-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">条目编辑</h3>
            <div>
              <label className={label}>主关键词（逗号分隔）</label>
              <input
                className={input}
                value={editingEntry.keys.join(", ")}
                onChange={(e) =>
                  setEditingEntry({ ...editingEntry, keys: splitKeys(e.target.value) })
                }
              />
            </div>
            <div>
              <label className={label}>副关键词（逗号分隔；selective 开启时生效）</label>
              <input
                className={input}
                value={editingEntry.secondaryKeys.join(", ")}
                onChange={(e) =>
                  setEditingEntry({ ...editingEntry, secondaryKeys: splitKeys(e.target.value) })
                }
              />
            </div>
            <div>
              <label className={label}>内容</label>
              <textarea
                className={`${input} h-24`}
                value={editingEntry.content}
                onChange={(e) => setEditingEntry({ ...editingEntry, content: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingEntry.constant}
                  onChange={(e) => setEditingEntry({ ...editingEntry, constant: e.target.checked })}
                />
                常驻（无视关键词）
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingEntry.enabled}
                  onChange={(e) => setEditingEntry({ ...editingEntry, enabled: e.target.checked })}
                />
                启用
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingEntry.selective}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, selective: e.target.checked })
                  }
                />
                启用副关键词
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editingEntry.preventRecursion}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, preventRecursion: e.target.checked })
                  }
                />
                阻止递归
              </label>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={label}>插入顺序</label>
                <input
                  className={input}
                  type="number"
                  value={editingEntry.insertionOrder}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, insertionOrder: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className={label}>插入位置</label>
                <select
                  className={input}
                  value={editingEntry.position}
                  onChange={(e) =>
                    setEditingEntry({
                      ...editingEntry,
                      position: e.target.value as LorebookEntryData["position"],
                    })
                  }
                >
                  <option value="beforeChar">角色描述前</option>
                  <option value="afterChar">角色描述后</option>
                  <option value="atDepth">历史深度注入</option>
                  <option value="anTop">作者注上（不支持）</option>
                  <option value="anBottom">作者注下（不支持）</option>
                  <option value="beforeExample">示例前（不支持）</option>
                  <option value="afterExample">示例后（不支持）</option>
                  <option value="outlet">Outlet（不支持）</option>
                </select>
              </div>
              <div>
                <label className={label}>深度（atDepth）</label>
                <input
                  className={input}
                  type="number"
                  value={editingEntry.depth ?? 4}
                  onChange={(e) =>
                    setEditingEntry({ ...editingEntry, depth: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                className={`${btn} bg-neutral-800 hover:bg-neutral-700`}
                onClick={() => setEditingEntry(null)}
              >
                取消
              </button>
              <button
                className={`${btn} bg-blue-700 text-white hover:bg-blue-600`}
                disabled={busy}
                onClick={() => void saveCurrentEntry()}
              >
                保存条目
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
      <div className="space-y-2 rounded border border-neutral-800 p-3">
        <div>
          <label className={label}>书名</label>
          <input
            className={input}
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
            <label className={label}>token 预算（留空 = 全局 25%）</label>
            <input
              className={input}
              type="number"
              placeholder="2048"
              defaultValue={current.tokenBudget ?? ""}
              onBlur={(e) => {
                const value = e.target.value === "" ? null : Number(e.target.value);
                void updateBook(current.id, { tokenBudget: value });
              }}
            />
          </div>
          <div>
            <label className={label}>扫描深度</label>
            <input
              className={input}
              type="number"
              placeholder="2"
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
                checked={current.isGlobal}
                onChange={(e) => void updateBook(current.id, { isGlobal: e.target.checked })}
              />
              全局书
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
      <div className="rounded border border-neutral-800 p-3">
        <h3 className="mb-2 text-sm font-semibold">挂载到角色</h3>
        <div className="flex flex-wrap gap-3 text-sm">
          {characters.map((c) => (
            <label key={c.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
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
