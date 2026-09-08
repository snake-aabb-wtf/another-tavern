/** 世界书 store：列表 / 当前书（含条目）/ 条目 CRUD / 导入 / 角色挂载。 */
import { create } from "zustand";

import { listCharacters } from "../api/characters.js";
import {
  createEntry,
  createLorebook,
  deleteEntry as deleteEntryApi,
  deleteLorebook as deleteLorebookApi,
  getCharacterLorebookLinks,
  getLorebook,
  importWorldInfo,
  listLorebooks,
  setCharacterLorebookLinks,
  updateEntry as updateEntryApi,
  updateLorebook,
  type LorebookDetail,
  type LorebookEntryData,
  type LorebookSummary,
  type WorldInfoImportResult,
} from "../api/lorebooks.js";

interface WorldInfoImportSummary {
  name: string;
  entryCount: number;
  warnings: Array<{ code: string; message: string }>;
}

interface LorebooksState {
  items: LorebookSummary[];
  current: LorebookDetail | null;
  /** 当前书被哪些角色挂载 */
  linkedCharacterIds: string[];
  lastImport: WorldInfoImportSummary | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: (name: string) => Promise<string>;
  updateBook: (
    id: string,
    patch: {
      name?: string;
      description?: string;
      isGlobal?: boolean;
      tokenBudget?: number | null;
      scanDepth?: number | null;
      recursiveScanning?: boolean | null;
    },
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importBook: (file: File, isGlobal: boolean) => Promise<void>;
  saveEntry: (uid: string | null, entry: Partial<LorebookEntryData>) => Promise<void>;
  removeEntry: (uid: string) => Promise<void>;
  loadLinks: (bookId: string) => Promise<void>;
  toggleCharacterLink: (characterId: string) => Promise<void>;
}

export const useLorebooksStore = create<LorebooksState>((set, get) => ({
  items: [],
  current: null,
  linkedCharacterIds: [],
  lastImport: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const items = await listLorebooks();
      set({ items, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  open: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const current = await getLorebook(id);
      set({ current, loading: false });
      await get().loadLinks(id);
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  create: async (name: string) => {
    const book = await createLorebook({ name });
    await get().load();
    return book.id;
  },

  updateBook: async (
    id: string,
    patch: {
      name?: string;
      description?: string;
      isGlobal?: boolean;
      tokenBudget?: number | null;
      scanDepth?: number | null;
      recursiveScanning?: boolean | null;
    },
  ) => {
    await updateLorebook(id, patch);
    await get().load();
    if (get().current?.id === id) {
      await get().open(id);
    }
  },

  remove: async (id: string) => {
    await deleteLorebookApi(id);
    if (get().current?.id === id) {
      set({ current: null });
    }
    await get().load();
  },

  importBook: async (file: File, isGlobal: boolean) => {
    const result: WorldInfoImportResult = await importWorldInfo(file, isGlobal);
    set({
      lastImport: { name: result.name, entryCount: result.entryCount, warnings: result.warnings },
    });
    await get().load();
    await get().open(result.id);
  },

  saveEntry: async (uid: string | null, entry: Partial<LorebookEntryData>) => {
    const bookId = get().current?.id;
    if (bookId === undefined) {
      return;
    }
    if (uid === null) {
      await createEntry(bookId, entry);
    } else {
      await updateEntryApi(bookId, uid, entry);
    }
    await get().open(bookId);
  },

  removeEntry: async (uid: string) => {
    const bookId = get().current?.id;
    if (bookId === undefined) {
      return;
    }
    await deleteEntryApi(bookId, uid);
    await get().open(bookId);
  },

  /** 刷新当前书被哪些角色挂载（角色清单取自角色 API）。 */
  loadLinks: async (bookId: string) => {
    const characters = await listCharacters();
    const links = await Promise.all(
      characters.map(async (c) => ({
        characterId: c.id,
        linked: (await getCharacterLorebookLinks(c.id)).bookIds.includes(bookId),
      })),
    );
    set({ linkedCharacterIds: links.filter((l) => l.linked).map((l) => l.characterId) });
  },

  toggleCharacterLink: async (characterId: string) => {
    const bookId = get().current?.id;
    if (bookId === undefined) {
      return;
    }
    const { bookIds } = await getCharacterLorebookLinks(characterId);
    const next = bookIds.includes(bookId)
      ? bookIds.filter((id) => id !== bookId)
      : [...bookIds, bookId];
    await setCharacterLorebookLinks(characterId, next);
    set({
      linkedCharacterIds: (await getCharacterLorebookLinks(characterId)).bookIds.includes(bookId)
        ? [...get().linkedCharacterIds.filter((id) => id !== characterId), characterId]
        : get().linkedCharacterIds.filter((id) => id !== characterId),
    });
  },
}));
