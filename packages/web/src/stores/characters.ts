/** 角色卡 store：列表 / 导入 / 编辑。 */
import { create } from "zustand";

import {
  importCharacter,
  listCharacters,
  updateCharacter,
  type CharacterSummary,
  type CharacterPatch,
} from "../api/characters.js";

interface CharactersState {
  items: CharacterSummary[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  importCard: (file: File) => Promise<CharacterSummary>;
  update: (id: string, patch: CharacterPatch) => Promise<void>;
}

export const useCharactersStore = create<CharactersState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const items = await listCharacters();
      set({ items, loading: false });
    } catch (error) {
      set({ loading: false, error: message(error) });
    }
  },

  importCard: async (file: File) => {
    const created = await importCharacter(file);
    await get().load();
    return { id: created.id, name: created.name, createdAt: "" };
  },

  update: async (id: string, patch: CharacterPatch) => {
    await updateCharacter(id, patch);
    await get().load();
  },
}));

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
