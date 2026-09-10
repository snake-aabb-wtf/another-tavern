/** 新建群聊弹窗：选择角色并确定初始顺序。 */
import { useState } from "react";

import type { CharacterSummary } from "../api/characters.js";
import { useCharactersStore } from "../stores/characters.js";
import { useSessionsStore } from "../stores/sessions.js";
import { sidebar as t } from "../ui-text.js";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function GroupCreateDialog({ onClose, onCreated }: Props) {
  const characters = useCharactersStore((s) => s.items);
  const createGroupSession = useSessionsStore((s) => s.createGroupSession);
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const toggle = (id: string): void => {
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const move = (index: number, direction: -1 | 1): void => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= selected.length) {
      return;
    }
    setSelected((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  };

  const selectedCharacters = selected
    .map((id) => characters.find((character) => character.id === id))
    .filter((character): character is CharacterSummary => character !== undefined);

  const submit = async (): Promise<void> => {
    if (selected.length < 2) {
      setError(t.atLeastTwoMembers);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createGroupSession(selected, title.trim() || undefined);
      onCreated();
    } catch (reason) {
      setError(
        `${t.groupCreateFailed}${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-tavern-950/80 p-4">
      <div
        className="panel-pop max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        role="dialog"
        aria-label={t.groupTitle}
        aria-modal="true"
        data-testid="group-create-dialog"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-ink-100">{t.groupTitle}</h2>
          <button className="btn-ghost" onClick={onClose} aria-label={t.close}>
            ✕
          </button>
        </div>

        <label className="label-base">
          {t.groupTitle}
          <input
            className="input-base mt-1 w-full"
            placeholder={t.groupTitlePlaceholder}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <div className="mt-4 flex items-center justify-between text-xs text-ink-400">
          <span>{t.chooseMembers}</span>
          <span>{t.selectedMembers(selected.length)}</span>
        </div>
        <div className="mt-2 space-y-1 rounded-md border border-line bg-tavern-900/50 p-2">
          {characters.map((character) => (
            <label
              key={character.id}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink-200 hover:bg-tavern-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(character.id)}
                onChange={() => toggle(character.id)}
                className="accent-candle-400"
              />
              <span className="truncate">{character.name}</span>
              {selected.includes(character.id) && (
                <span className="ml-auto text-xs text-brass-400">
                  {selected.indexOf(character.id) + 1}
                </span>
              )}
            </label>
          ))}
          {characters.length === 0 && <p className="p-2 text-xs text-ink-500">{t.empty}</p>}
        </div>

        {selectedCharacters.length > 0 && (
          <div className="mt-4 space-y-1">
            <p className="text-xs text-ink-400">{t.selectedMembers(selectedCharacters.length)}</p>
            {selectedCharacters.map((character, index) => (
              <div
                key={character.id}
                className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm text-ink-200"
              >
                <span className="w-5 text-center text-xs text-brass-400">{index + 1}</span>
                <span className="flex-1 truncate">{character.name}</span>
                <button
                  className="btn-ghost"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={t.moveUp}
                >
                  ↑
                </button>
                <button
                  className="btn-ghost"
                  disabled={index === selectedCharacters.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={t.moveDown}
                >
                  ↓
                </button>
              </div>
            ))}
          </div>
        )}

        {error !== null && <p className="mt-3 text-xs text-ember-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            {t.close}
          </button>
          <button className="btn-primary" disabled={creating} onClick={() => void submit()}>
            {creating ? t.creatingGroup : t.createGroup}
          </button>
        </div>
      </div>
    </div>
  );
}
