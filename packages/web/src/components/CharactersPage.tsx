/** 角色卡页：拖拽/按钮导入、列表、查看与编辑基本信息、开始会话。 */
import { useEffect, useState } from "react";

import { getCharacter } from "../api/characters.js";
import { useCharactersStore } from "../stores/characters.js";
import { useSessionsStore } from "../stores/sessions.js";
import { characters as t } from "../ui-text.js";

interface EditForm {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
}

export default function CharactersPage({ onGoChat }: { onGoChat: () => void }) {
  const items = useCharactersStore((s) => s.items);
  const loading = useCharactersStore((s) => s.loading);
  const error = useCharactersStore((s) => s.error);
  const importCard = useCharactersStore((s) => s.importCard);
  const update = useCharactersStore((s) => s.update);
  const createSession = useSessionsStore((s) => s.createSession);

  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (editingId !== null) {
      void getCharacter(editingId).then((detail) => {
        const card = detail.card;
        setForm({
          name: card.name,
          description: card.description,
          personality: card.personality,
          scenario: card.scenario,
          firstMes: card.firstMes,
        });
      });
    } else {
      setForm(null);
    }
  }, [editingId]);

  async function doImport(file: File): Promise<void> {
    setBusy(true);
    setStatus(`${t.importing}${file.name}…`);
    try {
      const created = await importCard(file);
      setStatus(t.imported(created.name));
    } catch (e) {
      setStatus(`${t.importFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(): Promise<void> {
    if (editingId === null || form === null) {
      return;
    }
    setBusy(true);
    try {
      await update(editingId, form);
      setStatus(t.saved);
      setEditingId(null);
    } catch (e) {
      setStatus(`${t.saveFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function startChat(id: string, name: string): Promise<void> {
    setBusy(true);
    try {
      await createSession(id, name);
      onGoChat();
    } catch (e) {
      setStatus(`${t.createSessionFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded bg-neutral-900 p-2 text-sm outline-none ring-neutral-700 focus:ring-1";
  const btn = "rounded px-3 py-1.5 text-sm disabled:opacity-40";

  return (
    <div className="h-full overflow-y-auto p-6">
      <div
        className={`mb-4 flex h-28 flex-col items-center justify-center rounded border-2 border-dashed text-sm transition-colors ${
          dragOver ? "border-blue-500 bg-neutral-900" : "border-neutral-700 text-neutral-500"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file !== undefined) {
            void doImport(file);
          }
        }}
      >
        {t.dropHint}
        <label className={`${btn} mt-2 cursor-pointer bg-neutral-800 hover:bg-neutral-700`}>
          {t.pickFile}
          <input
            type="file"
            accept=".png,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) {
                void doImport(file);
                e.target.value = "";
              }
            }}
          />
        </label>
      </div>
      <p className="mb-3 min-h-5 text-xs text-neutral-400">
        {loading && t.loading}
        {error !== null && <span className="text-red-400">{error}</span>}
        {error === null && status}
      </p>

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded border border-neutral-800 p-3">
            {editingId === item.id && form !== null ? (
              <div className="space-y-2">
                <input
                  className={input}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t.form.name}
                />
                <textarea
                  className={input}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t.form.description}
                />
                <textarea
                  className={input}
                  value={form.personality}
                  onChange={(e) => setForm({ ...form, personality: e.target.value })}
                  placeholder={t.form.personality}
                />
                <textarea
                  className={input}
                  value={form.scenario}
                  onChange={(e) => setForm({ ...form, scenario: e.target.value })}
                  placeholder={t.form.scenario}
                />
                <textarea
                  className={input}
                  value={form.firstMes}
                  onChange={(e) => setForm({ ...form, firstMes: e.target.value })}
                  placeholder={t.form.firstMes}
                />
                <div className="flex gap-2">
                  <button
                    className={`${btn} bg-blue-700 text-white hover:bg-blue-600`}
                    disabled={busy}
                    onClick={() => void saveEdit()}
                  >
                    {t.save}
                  </button>
                  <button
                    className={`${btn} bg-neutral-800 hover:bg-neutral-700`}
                    onClick={() => setEditingId(null)}
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-neutral-500">{item.createdAt}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    className={`${btn} bg-neutral-800 hover:bg-neutral-700`}
                    onClick={() => setEditingId(item.id)}
                  >
                    {t.edit}
                  </button>
                  <button
                    className={`${btn} bg-blue-700 text-white hover:bg-blue-600`}
                    disabled={busy}
                    onClick={() => void startChat(item.id, item.name)}
                  >
                    {t.startChat}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {items.length === 0 && !loading && <li className="text-sm text-neutral-500">{t.empty}</li>}
      </ul>
    </div>
  );
}
