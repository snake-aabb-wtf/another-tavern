/** 正则脚本管理 API。 */
import { api } from "./client.js";

export type RegexPlacement = "userInput" | "aiOutput" | "prompt" | "worldInfo" | "markdown";

export interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings: string[];
  placement: RegexPlacement[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit: boolean;
  substituteRegex: "none" | "raw" | "escaped";
  minDepth: number | null;
  maxDepth: number | null;
}

export function getRegexScripts(): Promise<{ scripts: RegexScript[] }> {
  return api.get("/api/regex-scripts") as Promise<{ scripts: RegexScript[] }>;
}

export function saveRegexScripts(
  scripts: RegexScript[],
): Promise<{ scripts: RegexScript[]; warnings: string[] }> {
  return api.put("/api/regex-scripts", { scripts }) as Promise<{
    scripts: RegexScript[];
    warnings: string[];
  }>;
}

export function testRegexScript(
  script: RegexScript,
  text: string,
  placement: RegexPlacement,
): Promise<{ text: string; warnings: string[]; appliedScriptIds: string[] }> {
  return api.post("/api/regex-scripts/test", { script, text, placement }) as Promise<{
    text: string;
    warnings: string[];
    appliedScriptIds: string[];
  }>;
}
