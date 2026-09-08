/** 组装计划 API（M4 CRUD + 导入）。 */
import { api, uploadFile } from "./client.js";

export interface PlanSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemPlanSlotData {
  id: string;
  enabled: boolean;
  order: number;
  source?: "default" | "custom";
  content?: string;
}

export interface PlanData {
  id?: string;
  name?: string;
  systemSlots?: SystemPlanSlotData[];
  postHistory?: { enabled: boolean; position: "historyAfter" };
  extensions?: Record<string, unknown>;
  unknownFields?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlanDetail extends PlanSummary {
  plan: PlanData;
}

export interface PlanImportResult {
  id: string;
  name: string;
  plan: PlanData;
  warnings: string[];
}

export function listPlans(): Promise<PlanSummary[]> {
  return api.get("/api/plans") as Promise<PlanSummary[]>;
}

export function getPlan(id: string): Promise<PlanDetail> {
  return api.get(`/api/plans/${id}`) as Promise<PlanDetail>;
}

export function createPlan(body: { name: string; plan: PlanData }): Promise<PlanDetail> {
  return api.post("/api/plans", body) as Promise<PlanDetail>;
}

export function updatePlan(
  id: string,
  body: { name?: string; plan?: PlanData },
): Promise<PlanDetail> {
  return api.put(`/api/plans/${id}`, body) as Promise<PlanDetail>;
}

export function deletePlan(id: string): Promise<null> {
  return api.del(`/api/plans/${id}`) as Promise<null>;
}

export function importPreset(file: File): Promise<PlanImportResult> {
  return uploadFile("/api/plans/import", file) as Promise<PlanImportResult>;
}
