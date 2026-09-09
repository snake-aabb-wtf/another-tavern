/** 预设（组装计划）页：计划列表、槽位编排编辑器、ST 预设导入、全局默认设置。 */
import { useEffect, useState } from "react";

import type { PlanData, SystemPlanSlotData } from "../api/plans.js";
import { statusTone } from "../status-tone.js";
import { usePlansStore } from "../stores/plans.js";
import { useSettingsStore } from "../stores/settings.js";
import { app as ta, plans as t } from "../ui-text.js";

const SLOT_LABELS: Record<string, string> = t.slotLabels;

export default function PlansPage() {
  const items = usePlansStore((s) => s.items);
  const current = usePlansStore((s) => s.current);
  const lastImport = usePlansStore((s) => s.lastImport);
  const load = usePlansStore((s) => s.load);
  const open = usePlansStore((s) => s.open);
  const create = usePlansStore((s) => s.create);
  const save = usePlansStore((s) => s.save);
  const remove = usePlansStore((s) => s.remove);
  const importPresetFile = usePlansStore((s) => s.importPresetFile);
  const settings = useSettingsStore((s) => s.settings);
  const saveSettings = useSettingsStore((s) => s.save);

  const [slots, setSlots] = useState<SystemPlanSlotData[]>([]);
  const [name, setName] = useState("");
  const [phiEnabled, setPhiEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (current !== null) {
      setSlots(current.plan.systemSlots ?? []);
      setName(current.name);
      setPhiEnabled(current.plan.postHistory?.enabled ?? true);
    }
  }, [current]);

  function move(index: number, direction: -1 | 1): void {
    setSlots((prev) => {
      const next = [...prev];
      const target = index + direction;
      const current = next[index];
      const swapWith = next[target];
      if (current === undefined || swapWith === undefined || target < 0 || target >= next.length) {
        return prev;
      }
      next[index] = swapWith;
      next[target] = current;
      // 重排序号：数组次序 ×10
      return next.map((slot, i) => ({ ...slot, order: (i + 1) * 10 }));
    });
  }

  async function doSave(): Promise<void> {
    if (current === null) {
      return;
    }
    setBusy(true);
    try {
      const plan: PlanData = {
        ...current.plan,
        name,
        systemSlots: slots,
        postHistory: { enabled: phiEnabled, position: "historyAfter" },
      };
      await save(current.id, { name, plan });
      setStatus(t.saved);
    } catch (e) {
      setStatus(`${t.saveFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function doImport(file: File): Promise<void> {
    setBusy(true);
    setStatus(t.importingStatus);
    try {
      await importPresetFile(file);
      setStatus(t.importDone);
    } catch (e) {
      setStatus(`${t.importFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左：计划列表 + 导入 + 全局默认 */}
      <div className="w-72 shrink-0 space-y-3 overflow-y-auto border-r border-line p-3">
        <h2 className="page-title px-1">{ta.pages.plans}</h2>
        <div>
          <label className="label-base">{t.importSt}</label>
          <input
            type="file"
            accept=".json"
            className="w-full text-xs text-ink-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-candle-300 file:mr-2 file:cursor-pointer file:rounded-md file:border-0 file:bg-candle-500 file:px-2 file:py-1 file:text-xs file:font-medium file:text-tavern-950 hover:file:bg-candle-400"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file !== undefined) {
                void doImport(file);
                e.target.value = "";
              }
            }}
          />
        </div>
        {lastImport !== null && (
          <div className="rounded-lg border border-line p-2 text-xs text-ink-400">
            <p className="text-ink-100">
              {t.importSummary}
              {lastImport.name}
            </p>
            <p>{t.enabledSlots(lastImport.enabledSlots.join(", ") || "—")}</p>
            <p>{t.disabledSlots(lastImport.disabledSlots.join(", ") || "—")}</p>
            {lastImport.droppedFields.length > 0 && (
              <p className="text-candle-400">{t.dropped(lastImport.droppedFields.join("、"))}</p>
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
          {t.newPlan}
        </button>
        <ul className="space-y-1">
          {items.map((p) => (
            <li key={p.id}>
              <button
                className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  current?.id === p.id
                    ? "bg-tavern-800 text-candle-300"
                    : "text-ink-300 hover:bg-tavern-800"
                }`}
                onClick={() => void open(p.id)}
              >
                {settings?.defaultPlanId === p.id && (
                  <span className="mr-1 text-candle-400">{t.defaultBadge}</span>
                )}
                {p.name}
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-3 text-center text-xs text-ink-400">{t.noPlans}</li>
          )}
        </ul>
      </div>

      {/* 右：计划编辑器 */}
      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {current === null ? (
          <p className="m-auto text-sm text-ink-400">{t.pickPlan}</p>
        ) : (
          <div className="mx-auto w-full max-w-2xl space-y-4">
            <div className="flex items-center gap-2">
              <input
                className="input-base flex-1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => {
                  void saveSettings({ defaultPlanId: current.id }).then(() =>
                    setStatus(t.setGlobalDefaultDone),
                  );
                }}
              >
                {t.setGlobalDefault}
              </button>
            </div>

            <div className="space-y-2">
              {slots.map((slot, index) => (
                <div key={slot.id} className="panel p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex flex-col">
                      <button
                        className="btn-ghost"
                        aria-label={t.moveUp}
                        disabled={index === 0 || busy}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn-ghost"
                        aria-label={t.moveDown}
                        disabled={index === slots.length - 1 || busy}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </button>
                    </span>
                    <span className="flex-1 text-sm font-medium text-ink-100">
                      {SLOT_LABELS[slot.id] ?? slot.id}
                    </span>
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        className="accent-candle-500"
                        checked={slot.enabled}
                        onChange={(e) =>
                          setSlots((prev) =>
                            prev.map((s) =>
                              s.id === slot.id ? { ...s, enabled: e.target.checked } : s,
                            ),
                          )
                        }
                      />
                      {t.enabled}
                    </label>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        className="accent-candle-500"
                        name={`src-${slot.id}`}
                        checked={slot.source !== "custom"}
                        onChange={() =>
                          setSlots((prev) =>
                            prev.map((s) => (s.id === slot.id ? { ...s, source: "default" } : s)),
                          )
                        }
                      />
                      {t.defaultSource}
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        className="accent-candle-500"
                        name={`src-${slot.id}`}
                        checked={slot.source === "custom"}
                        onChange={() =>
                          setSlots((prev) =>
                            prev.map((s) =>
                              s.id === slot.id
                                ? { ...s, source: "custom", content: s.content ?? "" }
                                : s,
                            ),
                          )
                        }
                      />
                      {t.customText}
                    </label>
                  </div>
                  {slot.source === "custom" && (
                    <textarea
                      className="input-base mt-2 h-20 w-full"
                      placeholder={t.customPlaceholder}
                      value={slot.content ?? ""}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s) =>
                            s.id === slot.id ? { ...s, content: e.target.value } : s,
                          ),
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-lg border border-line p-3">
              <span className="text-sm">{t.phi}</span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  className="accent-candle-500"
                  checked={phiEnabled}
                  onChange={(e) => setPhiEnabled(e.target.checked)}
                />
                {t.enabled}
              </label>
            </div>

            <div className="flex items-center gap-3">
              <button className="btn-primary" disabled={busy} onClick={() => void doSave()}>
                {t.savePlan}
              </button>
              <button
                className="btn-secondary text-ember-400 hover:text-ember-500"
                disabled={busy}
                onClick={() => {
                  void remove(current.id);
                }}
              >
                {t.deletePlan}
              </button>
              <span
                className={`text-xs ${statusTone(status, [t.importFailed, t.saveFailed], [t.importingStatus])}`}
              >
                {status}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
