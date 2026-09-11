/** 正则脚本列表状态。 */
import { create } from "zustand";

import { getRegexScripts, saveRegexScripts, type RegexScript } from "../api/regex.js";

interface RegexState {
  scripts: RegexScript[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (scripts: RegexScript[]) => Promise<string[]>;
}

export const useRegexStore = create<RegexState>((set) => ({
  scripts: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const result = await getRegexScripts();
      set({ scripts: result.scripts, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  save: async (scripts) => {
    try {
      const result = await saveRegexScripts(scripts);
      set({ scripts: result.scripts, error: null });
      return result.warnings;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
