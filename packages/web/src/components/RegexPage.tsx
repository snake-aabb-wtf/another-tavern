/** 正则脚本管理页：编辑全局规则并提供单条预览。 */
import { useEffect, useState } from "react";

import { testRegexScript, type RegexPlacement, type RegexScript } from "../api/regex.js";
import { statusTone } from "../status-tone.js";
import { useRegexStore } from "../stores/regex.js";
import { regex as t } from "../ui-text.js";

const PLACEMENTS: ReadonlyArray<readonly [RegexPlacement, string]> = [
  ["userInput", t.placements.userInput],
  ["aiOutput", t.placements.aiOutput],
  ["prompt", t.placements.prompt],
  ["worldInfo", t.placements.worldInfo],
  ["markdown", t.placements.markdown],
];

function blankScript(): RegexScript {
  return {
    id: crypto.randomUUID(),
    scriptName: t.newRule,
    findRegex: "/foo/g",
    replaceString: "bar",
    trimStrings: [],
    placement: ["aiOutput"],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    runOnEdit: false,
    substituteRegex: "none",
    minDepth: null,
    maxDepth: null,
  };
}

export default function RegexPage() {
  const scripts = useRegexStore((s) => s.scripts);
  const error = useRegexStore((s) => s.error);
  const loading = useRegexStore((s) => s.loading);
  const load = useRegexStore((s) => s.load);
  const save = useRegexStore((s) => s.save);
  const [draft, setDraft] = useState<RegexScript | null>(null);
  const [testInput, setTestInput] = useState("");
  const [testOutput, setTestOutput] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const updateDraft = (patch: Partial<RegexScript>): void => {
    setDraft((current) => (current === null ? current : { ...current, ...patch }));
  };

  async function saveDraft(): Promise<void> {
    if (draft === null || draft.scriptName.trim() === "") {
      setStatus(t.nameRequired);
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const next = scripts.some((item) => item.id === draft.id)
        ? scripts.map((item) => (item.id === draft.id ? draft : item))
        : [...scripts, draft];
      const warnings = await save(next);
      setDraft(null);
      setStatus(warnings.length > 0 ? `${t.saved} ${warnings.join(", ")}` : t.saved);
    } catch (reason) {
      setStatus(`${t.saveFailed}${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function runTest(): Promise<void> {
    if (draft === null || draft.placement.length === 0) {
      setStatus(t.placementRequired);
      return;
    }
    setBusy(true);
    try {
      const result = await testRegexScript(draft, testInput, draft.placement[0]!);
      setTestOutput(result.text);
      setStatus(result.warnings.length > 0 ? result.warnings.join(", ") : t.tested);
    } catch (reason) {
      setStatus(`${t.testFailed}${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteScript(id: string): Promise<void> {
    setBusy(true);
    try {
      await save(scripts.filter((item) => item.id !== id));
      if (draft?.id === id) {
        setDraft(null);
      }
      setStatus(t.deleted);
    } catch (reason) {
      setStatus(`${t.saveFailed}${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl space-y-4">
        <h2 className="page-title">{t.title}</h2>
        <p className="text-xs text-ink-400">{t.description}</p>
        {error !== null && <p className="text-xs text-ember-400">{error}</p>}
        {loading && <p className="text-xs text-ink-500">{t.loading}</p>}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <section className="panel space-y-2 p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm text-ink-100">{t.globalRules}</h3>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setDraft(blankScript())}
              >
                {t.newRule}
              </button>
            </div>
            {scripts.map((script) => (
              <div
                key={script.id}
                className="flex items-center gap-2 rounded-md border border-line p-2"
              >
                <button
                  className="btn-ghost flex-1 truncate text-left"
                  onClick={() =>
                    setDraft({
                      ...script,
                      trimStrings: [...script.trimStrings],
                      placement: [...script.placement],
                    })
                  }
                >
                  {script.scriptName}
                </button>
                <span className="text-xs text-ink-500">
                  {script.disabled ? t.disabled : t.enabled}
                </span>
                <button
                  className="btn-ghost-danger"
                  disabled={busy}
                  onClick={() => void deleteScript(script.id)}
                >
                  {t.delete}
                </button>
              </div>
            ))}
            {scripts.length === 0 && <p className="text-xs text-ink-500">{t.empty}</p>}
          </section>

          <section className="panel space-y-3 p-3">
            {draft === null ? (
              <p className="text-sm text-ink-400">{t.pickRule}</p>
            ) : (
              <>
                <div>
                  <label className="label-base">{t.name}</label>
                  <input
                    className="input-base w-full"
                    value={draft.scriptName}
                    onChange={(e) => updateDraft({ scriptName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label-base">{t.findRegex}</label>
                  <input
                    className="input-base w-full font-mono"
                    value={draft.findRegex}
                    onChange={(e) => updateDraft({ findRegex: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label-base">{t.replaceString}</label>
                  <input
                    className="input-base w-full"
                    value={draft.replaceString}
                    onChange={(e) => updateDraft({ replaceString: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label-base">{t.trimStrings}</label>
                  <textarea
                    className="input-base min-h-16 w-full"
                    value={draft.trimStrings.join("\n")}
                    onChange={(e) =>
                      updateDraft({
                        trimStrings: e.target.value.split("\n").filter((item) => item !== ""),
                      })
                    }
                  />
                </div>
                <fieldset className="space-y-1">
                  <legend className="label-base">{t.placementsTitle}</legend>
                  {PLACEMENTS.map(([id, label]) => (
                    <label
                      key={id}
                      className="mr-3 inline-flex items-center gap-1.5 text-xs text-ink-300"
                    >
                      <input
                        type="checkbox"
                        checked={draft.placement.includes(id)}
                        onChange={(e) =>
                          updateDraft({
                            placement: e.target.checked
                              ? [...draft.placement, id]
                              : draft.placement.filter((item) => item !== id),
                          })
                        }
                        className="accent-candle-400"
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
                <label className="inline-flex items-center gap-1.5 text-xs text-ink-300">
                  <input
                    type="checkbox"
                    checked={draft.disabled}
                    onChange={(e) => updateDraft({ disabled: e.target.checked })}
                    className="accent-candle-400"
                  />
                  {t.disabled}
                </label>
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={busy} onClick={() => void saveDraft()}>
                    {t.save}
                  </button>
                  <button className="btn-ghost" onClick={() => setDraft(null)}>
                    {t.cancel}
                  </button>
                </div>

                <div className="border-t border-line pt-3">
                  <label className="label-base">{t.testInput}</label>
                  <textarea
                    className="input-base min-h-20 w-full"
                    value={testInput}
                    onChange={(e) => setTestInput(e.target.value)}
                  />
                  <button
                    className="btn-secondary mt-2"
                    disabled={busy}
                    onClick={() => void runTest()}
                  >
                    {t.test}
                  </button>
                  {testOutput !== "" && (
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-tavern-950 p-2 text-xs text-ink-300">
                      {testOutput}
                    </pre>
                  )}
                </div>
              </>
            )}
            <span className={`text-xs ${statusTone(status, [t.saveFailed, t.testFailed])}`}>
              {status}
            </span>
          </section>
        </div>
        <p className="text-xs text-ink-500">{t.scopeNote}</p>
      </div>
    </div>
  );
}
