/** 群聊成员顺序、静音与发言策略设置。 */
import { useEffect, useState } from "react";

import type { GroupSettings, SessionMemberPatch } from "../api/sessions.js";
import { useSessionsStore } from "../stores/sessions.js";
import { chat as t } from "../ui-text.js";

interface Props {
  onClose: () => void;
}

interface DraftMember extends SessionMemberPatch {
  characterName: string;
}

export default function GroupSettingsPanel({ onClose }: Props) {
  const members = useSessionsStore((s) => s.currentMembers);
  const settings = useSessionsStore((s) => s.currentGroupSettings);
  const saveMembers = useSessionsStore((s) => s.saveGroupMembers);
  const saveSettings = useSessionsStore((s) => s.saveGroupSettings);
  const [draftMembers, setDraftMembers] = useState<DraftMember[]>([]);
  const [strategy, setStrategy] = useState<"manual" | "list">("manual");
  const [scenario, setScenario] = useState("");
  const [allowSelfResponses, setAllowSelfResponses] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftMembers(
      members.map((member) => ({
        characterId: member.characterId,
        characterName: member.characterName,
        muted: member.muted,
        talkativeness: member.talkativeness,
      })),
    );
    setStrategy(settings?.replyStrategy ?? "manual");
    setScenario(settings?.scenarioOverride ?? "");
    setAllowSelfResponses(settings?.allowSelfResponses ?? false);
  }, [members, settings]);

  const move = (index: number, direction: -1 | 1): void => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftMembers.length) {
      return;
    }
    setDraftMembers((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const memberPatch = draftMembers.map(({ characterId, muted, talkativeness }) => ({
        characterId,
        muted,
        talkativeness,
      }));
      await saveMembers(memberPatch);
      await saveSettings({
        replyStrategy: strategy,
        scenarioOverride: scenario.trim() || null,
        allowSelfResponses,
      });
      onClose();
    } catch (reason) {
      setError(
        `${t.groupSettingsFailed}${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="panel-pop absolute right-3 top-14 z-10 w-[min(24rem,calc(100%-1.5rem))] p-4 shadow-pop"
      role="dialog"
      aria-label={t.groupSettingsTitle}
      aria-modal="true"
      data-testid="group-settings-dialog"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base text-ink-100">{t.groupSettingsTitle}</h2>
        <button className="btn-ghost" onClick={onClose} aria-label={t.cancel}>
          ✕
        </button>
      </div>

      <div className="space-y-2">
        {draftMembers.map((member, index) => (
          <div
            key={member.characterId}
            className="rounded-md border border-line p-2"
            data-testid={`group-member-${member.characterId}`}
          >
            <div className="flex items-center gap-2">
              <span className="w-5 text-center text-xs text-brass-400">{index + 1}</span>
              <span className="flex-1 truncate text-sm text-ink-200">{member.characterName}</span>
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
                disabled={index === draftMembers.length - 1}
                onClick={() => move(index, 1)}
                aria-label={t.moveDown}
              >
                ↓
              </button>
              <button
                className="btn-ghost-danger"
                disabled={draftMembers.length <= 2}
                onClick={() =>
                  setDraftMembers((current) =>
                    current.filter((item) => item.characterId !== member.characterId),
                  )
                }
                aria-label={t.removeMember}
              >
                ✕
              </button>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-ink-400">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={member.muted}
                  onChange={(event) =>
                    setDraftMembers((current) =>
                      current.map((item) =>
                        item.characterId === member.characterId
                          ? { ...item, muted: event.target.checked }
                          : item,
                      ),
                    )
                  }
                  className="accent-candle-400"
                />
                {t.muted}
              </label>
              <label className="flex flex-1 items-center gap-1.5">
                <span>{member.talkativeness}</span>
                <input
                  className="w-full accent-candle-400"
                  type="range"
                  min="0"
                  max="100"
                  value={member.talkativeness}
                  onChange={(event) =>
                    setDraftMembers((current) =>
                      current.map((item) =>
                        item.characterId === member.characterId
                          ? { ...item, talkativeness: Number(event.target.value) }
                          : item,
                      ),
                    )
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <label className="label-base mt-4">
        {t.replyStrategy}
        <select
          className="input-base mt-1 w-full"
          value={strategy}
          onChange={(event) => setStrategy(event.target.value as GroupSettings["replyStrategy"])}
        >
          <option value="manual">{t.manualStrategy}</option>
          <option value="list">{t.listStrategy}</option>
        </select>
      </label>
      <label className="label-base mt-3">
        {t.scenarioOverride}
        <textarea
          className="input-base mt-1 min-h-16 w-full resize-y"
          placeholder={t.scenarioPlaceholder}
          value={scenario}
          onChange={(event) => setScenario(event.target.value)}
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-xs text-ink-300">
        <input
          type="checkbox"
          checked={allowSelfResponses}
          onChange={(event) => setAllowSelfResponses(event.target.checked)}
          className="accent-candle-400"
        />
        {t.allowSelfResponses}
      </label>

      {error !== null && <p className="mt-3 text-xs text-ember-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>
          {t.cancel}
        </button>
        <button
          className="btn-primary"
          disabled={saving || draftMembers.length < 2}
          onClick={() => void save()}
        >
          {saving ? t.saving : t.saveGroupSettings}
        </button>
      </div>
    </div>
  );
}
