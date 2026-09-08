/** 连接设置 API（apiKey 永远是打码值；空提交 = 保留原值）。 */
import { api } from "./client.js";

export interface SettingsData {
  baseUrl: string;
  model: string;
  apiKey: string;
  hasApiKey: boolean;
  sampling: Record<string, unknown>;
}

export function getSettings(): Promise<SettingsData> {
  return api.get("/api/settings") as Promise<SettingsData>;
}

export interface SettingsPatch {
  baseUrl?: string;
  model?: string;
  /** 空串/缺省 = 保留已存的 key（后端语义）。 */
  apiKey?: string;
  sampling?: Record<string, unknown>;
}

export function updateSettings(patch: SettingsPatch): Promise<SettingsData> {
  return api.put("/api/settings", patch) as Promise<SettingsData>;
}
