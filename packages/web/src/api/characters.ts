/** 角色卡 API。 */
import { api, uploadFile } from "./client.js";

export interface CharacterSummary {
  id: string;
  name: string;
  createdAt: string;
}

export interface CharacterCardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstMes: string;
  [key: string]: unknown;
}

export interface CharacterDetail {
  id: string;
  name: string;
  createdAt: string;
  card: CharacterCardData;
}

export function listCharacters(): Promise<CharacterSummary[]> {
  return api.get("/api/characters") as Promise<CharacterSummary[]>;
}

export function getCharacter(id: string): Promise<CharacterDetail> {
  return api.get(`/api/characters/${id}`) as Promise<CharacterDetail>;
}

export function importCharacter(file: File): Promise<{ id: string; name: string }> {
  return uploadFile("/api/characters/import", file) as Promise<{ id: string; name: string }>;
}

export interface CharacterPatch {
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMes?: string;
}

export function updateCharacter(
  id: string,
  patch: CharacterPatch,
): Promise<{ id: string; name: string }> {
  return api.put(`/api/characters/${id}`, patch) as Promise<{ id: string; name: string }>;
}
