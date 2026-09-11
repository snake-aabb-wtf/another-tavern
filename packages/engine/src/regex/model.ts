/** 正则脚本的作用位置。字符串形式便于 API 与角色卡扩展稳定存储。 */
export type RegexPlacement = "userInput" | "aiOutput" | "prompt" | "worldInfo" | "markdown";

/** 正则脚本中 findRegex 的宏替换模式。 */
export type RegexSubstitution = "none" | "raw" | "escaped";

/** 与 SillyTavern regex_scripts 兼容的规范化脚本模型。 */
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
  substituteRegex: RegexSubstitution;
  minDepth: number | null;
  maxDepth: number | null;
}

/** 正则执行时可用的宏上下文。 */
export interface RegexMacroContext {
  char?: string;
  user?: string;
}

/** 正则脚本执行结果，包含可展示的告警与实际执行顺序。 */
export interface RegexApplyResult {
  text: string;
  warnings: string[];
  appliedScriptIds: string[];
}
