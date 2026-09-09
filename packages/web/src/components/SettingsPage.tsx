/** 设置页：上游接口与采样参数（key 不回显明文，空提交 = 保留）。 */
import { useEffect, useState } from "react";

import { useSettingsStore } from "../stores/settings.js";
import { settings as t } from "../ui-text.js";

export default function SettingsPage() {
  const settings = useSettingsStore((s) => s.settings);
  const error = useSettingsStore((s) => s.error);
  const load = useSettingsStore((s) => s.load);
  const save = useSettingsStore((s) => s.save);

  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [temperature, setTemperature] = useState("");
  const [topP, setTopP] = useState("");
  const [maxTokens, setMaxTokens] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (settings !== null) {
      setBaseUrl(settings.baseUrl);
      setModel(settings.model);
      const s = settings.sampling;
      setTemperature(s.temperature !== undefined ? String(s.temperature) : "");
      setTopP(s.top_p !== undefined ? String(s.top_p) : "");
      setMaxTokens(s.max_tokens !== undefined ? String(s.max_tokens) : "");
    }
  }, [settings]);

  async function doSave(): Promise<void> {
    setBusy(true);
    setStatus("");
    const sampling: Record<string, unknown> = {};
    if (temperature !== "") {
      sampling.temperature = Number(temperature);
    }
    if (topP !== "") {
      sampling.top_p = Number(topP);
    }
    if (maxTokens !== "") {
      sampling.max_tokens = Number(maxTokens);
    }
    try {
      await save({ baseUrl, model, apiKey, sampling });
      setApiKey("");
      setStatus(t.saved);
    } catch (e) {
      setStatus(`${t.saveFailed}${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const label = "mb-1 block text-xs text-neutral-400";
  const input =
    "w-full rounded bg-neutral-900 p-2 text-sm outline-none ring-neutral-700 focus:ring-1";
  const btn = "rounded px-4 py-1.5 text-sm disabled:opacity-40";

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-xl space-y-4">
        <h2 className="text-lg font-semibold">{t.title}</h2>
        {error !== null && <p className="text-xs text-red-400">{error}</p>}
        <div>
          <label className={label}>{t.baseUrl}</label>
          <input
            className={input}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
        </div>
        <div>
          <label className={label}>{t.apiKeyLabel(settings?.hasApiKey === true)}</label>
          <input
            className={input}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.apiKey ?? ""}
          />
        </div>
        <div>
          <label className={label}>{t.model}</label>
          <input
            className={input}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t.modelPlaceholder}
          />
        </div>
        <fieldset className="space-y-3 rounded border border-neutral-800 p-3">
          <legend className="px-1 text-xs text-neutral-400">{t.samplingLegend}</legend>
          <div>
            <label className={label}>{t.temperature}</label>
            <input
              className={input}
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>{t.topP}</label>
            <input
              className={input}
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={topP}
              onChange={(e) => setTopP(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>{t.maxTokens}</label>
            <input
              className={input}
              type="number"
              step="1"
              min="1"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
            />
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button
            className={`${btn} bg-blue-700 text-white hover:bg-blue-600`}
            disabled={busy}
            onClick={() => void doSave()}
          >
            {t.save}
          </button>
          <span className="text-xs text-neutral-400">{status}</span>
        </div>
      </div>
    </div>
  );
}
