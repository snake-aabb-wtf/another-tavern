/** 连接设置 store：加载 / 保存（apiKey 由后端打码与保留）。 */
import { create } from "zustand";

import {
  getSettings,
  updateSettings,
  type SettingsData,
  type SettingsPatch,
} from "../api/settings.js";

interface SettingsState {
  settings: SettingsData | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (patch: SettingsPatch) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const settings = await getSettings();
      set({ settings, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  save: async (patch: SettingsPatch) => {
    const settings = await updateSettings(patch);
    set({ settings, error: null });
  },
}));
