/** 群聊第一阶段发言选择器：纯函数、无 IO、无时间和无随机。 */

export type SpeakerStrategy = "manual" | "list" | "force";

export interface SpeakerMember {
  characterId: string;
  position: number;
  muted: boolean;
}

export interface SpeakerHistoryItem {
  role: "user" | "assistant";
  speakerId?: string | null;
}

export interface ChooseNextSpeakerInput {
  strategy: SpeakerStrategy;
  members: readonly SpeakerMember[];
  history: readonly SpeakerHistoryItem[];
  /** manual / force 策略下的显式角色 id。 */
  speakerId?: string;
}

export interface SpeakerSelection {
  characterId: string;
  reason: SpeakerStrategy;
}

export type SpeakerSelectionErrorCode =
  "speaker_required" | "speaker_not_member" | "speaker_muted" | "no_available_speaker";

export class SpeakerSelectionError extends Error {
  readonly code: SpeakerSelectionErrorCode;

  constructor(code: SpeakerSelectionErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "SpeakerSelectionError";
    this.code = code;
  }
}

/** 根据显式选择或成员顺序确定下一名发言者。 */
export function chooseNextSpeaker(input: ChooseNextSpeakerInput): SpeakerSelection {
  if (input.strategy === "manual" || input.strategy === "force") {
    return chooseExplicit(input);
  }

  const available = [...input.members].filter((member) => !member.muted).sort(compareMembers);
  if (available.length === 0) {
    throw new SpeakerSelectionError("no_available_speaker", "没有可发言的群聊成员。");
  }

  const lastSpeakerId = [...input.history]
    .reverse()
    .find((message) => message.role === "assistant" && message.speakerId !== null)?.speakerId;
  if (lastSpeakerId === undefined || lastSpeakerId === null) {
    return { characterId: available[0]!.characterId, reason: "list" };
  }

  const lastIndex = available.findIndex((member) => member.characterId === lastSpeakerId);
  if (lastIndex < 0) {
    return { characterId: available[0]!.characterId, reason: "list" };
  }
  const next = available[(lastIndex + 1) % available.length]!;
  return { characterId: next.characterId, reason: "list" };
}

function chooseExplicit(input: ChooseNextSpeakerInput): SpeakerSelection {
  if (input.speakerId === undefined || input.speakerId === "") {
    throw new SpeakerSelectionError("speaker_required", "必须指定发言角色。");
  }
  const member = input.members.find((candidate) => candidate.characterId === input.speakerId);
  if (member === undefined) {
    throw new SpeakerSelectionError("speaker_not_member", "指定角色不是当前群聊成员。");
  }
  if (input.strategy === "manual" && member.muted) {
    throw new SpeakerSelectionError("speaker_muted", "指定角色已静音，请使用强制发言。");
  }
  return { characterId: member.characterId, reason: input.strategy };
}

function compareMembers(a: SpeakerMember, b: SpeakerMember): number {
  return a.position - b.position || a.characterId.localeCompare(b.characterId);
}
