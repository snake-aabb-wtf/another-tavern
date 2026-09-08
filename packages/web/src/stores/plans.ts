/** 组装计划 store：列表 / 当前计划编辑 / 导入 / 删除。 */
import { create } from "zustand";

import {
  createPlan,
  deletePlan as deletePlanApi,
  getPlan,
  importPreset,
  listPlans,
  updatePlan,
  type PlanData,
  type PlanDetail,
  type PlanImportResult,
  type PlanSummary,
} from "../api/plans.js";

interface PresetImportSummary {
  name: string;
  enabledSlots: string[];
  disabledSlots: string[];
  droppedFields: string[];
  warnings: string[];
}

interface PlansState {
  items: PlanSummary[];
  current: PlanDetail | null;
  lastImport: PresetImportSummary | null;
  loading: boolean;
  error: string | null;

  load: () => Promise<void>;
  open: (id: string) => Promise<void>;
  create: (name: string) => Promise<string>;
  save: (id: string, body: { name?: string; plan?: PlanData }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  importPresetFile: (file: File) => Promise<void>;
  clearImport: () => void;
}

/** 从导入结果提取"映射摘要"（哪些槽启用/禁用、哪些字段被丢弃）。 */
export function summarizeImport(result: PlanImportResult): PresetImportSummary {
  const slots = result.plan.systemSlots ?? [];
  const enabledSlots = slots.filter((s) => s.enabled).map((s) => s.id);
  const disabledSlots = slots.filter((s) => !s.enabled).map((s) => s.id);
  const droppedFields = [
    ...result.warnings,
    ...((result.plan.extensions?.unmappedPrompts as Array<{ identifier?: string }>) ?? []).map(
      (p) => `unmapped:${p.identifier ?? "?"}`,
    ),
  ];
  return {
    name: result.name,
    enabledSlots,
    disabledSlots,
    droppedFields,
    warnings: result.warnings,
  };
}

export const usePlansStore = create<PlansState>((set, get) => ({
  items: [],
  current: null,
  lastImport: null,
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const items = await listPlans();
      set({ items, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  open: async (id: string) => {
    set({ loading: true, error: null });
    try {
      const current = await getPlan(id);
      set({ current, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  },

  create: async (name: string) => {
    const detail = await createPlan({
      name,
      plan: { name, postHistory: { enabled: true, position: "historyAfter" } },
    });
    await get().load();
    return detail.id;
  },

  save: async (id: string, body: { name?: string; plan?: PlanData }) => {
    await updatePlan(id, body);
    await get().load();
    if (get().current?.id === id) {
      await get().open(id);
    }
  },

  remove: async (id: string) => {
    await deletePlanApi(id);
    if (get().current?.id === id) {
      set({ current: null });
    }
    await get().load();
  },

  importPresetFile: async (file: File) => {
    const result = await importPreset(file);
    set({ lastImport: summarizeImport(result) });
    await get().load();
    await get().open(result.id);
  },

  clearImport: () => set({ lastImport: null }),
}));
