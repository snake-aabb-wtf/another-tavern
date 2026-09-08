/**
 * 宏替换（docs/prompt-assembly.md §7）。
 * v1 集合：{{char}} <BOT> {{charIfNotGroup}} {{user}} <USER>，大小写不敏感；
 * 未识别的 {{...}} 原样保留；单次替换、不递归求值。
 */

export interface MacroContext {
  /** 卡 name（不对其自身执行替换，docs §7.2）。 */
  charName: string;
  /** 用户人设名。 */
  userName: string;
}

const MACRO_RE = /\{\{(char|charifnotgroup|user)\}\}|<(bot|user)>/gi;

/** 执行全局宏替换。 */
export function substituteMacros(text: string, ctx: MacroContext): string {
  return text.replace(MACRO_RE, (match) => {
    switch (match.toLowerCase()) {
      case "{{char}}":
      case "{{charifnotgroup}}":
      case "<bot>":
        return ctx.charName;
      default:
        return ctx.userName; // {{user}} / <user>
    }
  });
}

/**
 * {{original}} 占位符（仅 system_prompt / post_history_instructions 语境，
 * docs/cards-spec.md §3 与 prompt-assembly §3.1/§3.5）。
 */
export function substituteOriginal(cardValue: string, globalValue: string): string {
  return cardValue.replace(/\{\{original\}\}/gi, globalValue);
}
