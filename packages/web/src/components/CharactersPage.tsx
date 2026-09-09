/** 角色卡页：拖拽/按钮导入、列表、查看与编辑基本信息、开始会话。 */
import { useEffect, useState } from "react";

import { getCharacter } from "../api/characters.js";
import { statusTone } from "../status-tone.js";
import { useCharactersStore } from "../stores/characters.js";
import { useSessionsStore } from "../stores/sessions.js";
import { app as ta, characters as t } from "../ui-text.js";

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

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="page-title mb-4">{ta.pages.characters}</h2>
      <div
        className={`mb-4 flex h-28 flex-col items-center justify-center rounded-lg border-2 border-dashed text-sm transition-colors ${
          dragOver ? "border-candle-400 bg-tavern-800 text-ink-300" : "border-line text-ink-500"
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
        <label className="btn-secondary mt-2 cursor-pointer">
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
      <p className="mb-3 min-h-5 text-xs">
        {loading && <span className="text-ink-400">{t.loading}</span>}
        {error !== null && <span className="text-ember-400">{error}</span>}
        {error === null && status !== "" && (
          <span
            className={statusTone(
              status,
              [t.importFailed, t.saveFailed, t.createSessionFailed],
              [t.importing],
            )}
          >
            {status}
          </span>
        )}
      </p>

      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className={
              editingId === item.id
                ? "panel p-3"
                : "panel p-3 transition-colors hover:border-candle-600/40 hover:bg-tavern-800"
            }
          >
            {editingId === item.id && form !== null ? (
              <div className="space-y-2">
                <input
                  className="input-base w-full"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t.form.name}
                />
                <textarea
                  className="input-base w-full"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder={t.form.description}
                />
                <textarea
                  className="input-base w-full"
                  value={form.personality}
                  onChange={(e) => setForm({ ...form, personality: e.target.value })}
                  placeholder={t.form.personality}
                />
                <textarea
                  className="input-base w-full"
                  value={form.scenario}
                  onChange={(e) => setForm({ ...form, scenario: e.target.value })}
                  placeholder={t.form.scenario}
                />
                <textarea
                  className="input-base w-full"
                  value={form.firstMes}
                  onChange={(e) => setForm({ ...form, firstMes: e.target.value })}
                  placeholder={t.form.firstMes}
                />
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => void saveEdit()}>
                    {t.save}
                  </button>
                  <button className="btn-secondary" onClick={() => setEditingId(null)}>
                    {t.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-100">{item.name}</p>
                  <p className="text-xs text-ink-500">{item.createdAt}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button className="btn-secondary" onClick={() => setEditingId(item.id)}>
                    {t.edit}
                  </button>
                  <button
                    className="btn-primary"
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
        {items.length === 0 && !loading && (
          <li className="py-12 text-center text-sm text-ink-400">{t.empty}</li>
        )}
      </ul>
    </div>
  );
}
