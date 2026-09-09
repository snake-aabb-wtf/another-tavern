/** 设置页：上游接口与采样参数（key 不回显明文，空提交 = 保留）。 */
import { useEffect, useState } from "react";

import { statusTone } from "../status-tone.js";
import { useSettingsStore } from "../stores/settings.js";
import { settings as t } from "../ui-text.js";

/** 采样数值键的回显：仅接受有限 number（NaN / 其它类型 → 回显空串）。 */
function samplingNumberDisplay(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/** 采样字符串键（stop）的回显：仅接受 string，其余回显空串。 */
function samplingStringDisplay(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 表单键 → 采样底对象（docs/settings-spec §4.3 合并语义）：
 * 空串 = 删除该键（不发送）；非空 = 转换后写入；
 * 数字键转换结果非有限（NaN/∞）时按空串处理，避免被 JSON 序列化成 null。
 */
function applySamplingInput(
  target: Record<string, unknown>,
  key: string,
  raw: string,
  convert: (value: string) => unknown,
): void {
  if (raw === "") {
    delete target[key];
    return;
  }
  const value = convert(raw);
  if (typeof value === "number" && !Number.isFinite(value)) {
    delete target[key];
    return;
  }
  target[key] = value;
}

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
  const [frequencyPenalty, setFrequencyPenalty] = useState("");
  const [presencePenalty, setPresencePenalty] = useState("");
  const [stop, setStop] = useState("");
  const [seed, setSeed] = useState("");
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
      setTemperature(samplingNumberDisplay(s.temperature));
      setTopP(samplingNumberDisplay(s.top_p));
      setMaxTokens(samplingNumberDisplay(s.max_tokens));
      setFrequencyPenalty(samplingNumberDisplay(s.frequency_penalty));
      setPresencePenalty(samplingNumberDisplay(s.presence_penalty));
      setStop(samplingStringDisplay(s.stop));
      setSeed(samplingNumberDisplay(s.seed));
    }
  }, [settings]);

  async function doSave(): Promise<void> {
    setBusy(true);
    setStatus("");
    // 合并语义（docs/settings-spec §4.3）：以已加载的 sampling 为底对象应用 7 个表单键，
    // 空串 = 删除该键（不发送）；其余未知键原样保留，手工/API 存入的扩展键不被 UI 抹掉。
    const sampling: Record<string, unknown> = { ...(settings?.sampling ?? {}) };
    applySamplingInput(sampling, "temperature", temperature, Number);
    applySamplingInput(sampling, "top_p", topP, Number);
    applySamplingInput(sampling, "max_tokens", maxTokens, Number);
    applySamplingInput(sampling, "frequency_penalty", frequencyPenalty, Number);
    applySamplingInput(sampling, "presence_penalty", presencePenalty, Number);
    applySamplingInput(sampling, "stop", stop, (raw) => raw);
    applySamplingInput(sampling, "seed", seed, Number);
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

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-xl space-y-4">
        <h2 className="page-title">{t.title}</h2>
        {error !== null && <p className="text-xs text-ember-400">{error}</p>}
        <div>
          <label className="label-base">{t.baseUrl}</label>
          <input
            className="input-base w-full"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={t.baseUrlPlaceholder}
          />
        </div>
        <div>
          <label className="label-base">{t.apiKeyLabel(settings?.hasApiKey === true)}</label>
          <input
            className="input-base w-full"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={settings?.apiKey ?? ""}
          />
        </div>
        <div>
          <label className="label-base">{t.model}</label>
          <input
            className="input-base w-full"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={t.modelPlaceholder}
          />
        </div>
        <fieldset className="panel space-y-3 p-3">
          <legend className="px-1 text-xs text-brass-400">{t.samplingLegend}</legend>
          <div>
            <label className="label-base">{t.temperature}</label>
            <input
              className="input-base w-full"
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
            />
          </div>
          <div>
            <label className="label-base">{t.topP}</label>
            <input
              className="input-base w-full"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={topP}
              onChange={(e) => setTopP(e.target.value)}
            />
          </div>
          <div>
            <label className="label-base">{t.maxTokens}</label>
            <input
              className="input-base w-full"
              type="number"
              step="1"
              min="1"
              value={maxTokens}
              onChange={(e) => setMaxTokens(e.target.value)}
            />
          </div>
          <div>
            <label className="label-base">{t.frequencyPenalty}</label>
            <input
              className="input-base w-full"
              type="number"
              step="0.1"
              min="-2"
              max="2"
              value={frequencyPenalty}
              onChange={(e) => setFrequencyPenalty(e.target.value)}
            />
          </div>
          <div>
            <label className="label-base">{t.presencePenalty}</label>
            <input
              className="input-base w-full"
              type="number"
              step="0.1"
              min="-2"
              max="2"
              value={presencePenalty}
              onChange={(e) => setPresencePenalty(e.target.value)}
            />
          </div>
          <div>
            <label className="label-base">{t.stop}</label>
            <input
              className="input-base w-full"
              value={stop}
              onChange={(e) => setStop(e.target.value)}
            />
          </div>
          <div>
            <label className="label-base">{t.seed}</label>
            <input
              className="input-base w-full"
              type="number"
              step="1"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
            />
          </div>
        </fieldset>
        <div className="flex items-center gap-3">
          <button className="btn-primary" disabled={busy} onClick={() => void doSave()}>
            {t.save}
          </button>
          <span className={`text-xs ${statusTone(status, [t.saveFailed])}`}>{status}</span>
        </div>
      </div>
    </div>
  );
}
