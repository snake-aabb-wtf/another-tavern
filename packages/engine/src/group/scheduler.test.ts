import { describe, expect, it } from "vitest";

import { chooseNextSpeaker, SpeakerSelectionError, type SpeakerMember } from "./scheduler.js";

const members: SpeakerMember[] = [
  { characterId: "aria", position: 0, muted: false },
  { characterId: "lisa", position: 1, muted: false },
  { characterId: "kaeya", position: 2, muted: false },
];

describe("group speaker scheduler", () => {
  it("manual：选择明确的未静音成员", () => {
    expect(
      chooseNextSpeaker({ strategy: "manual", members, history: [], speakerId: "lisa" }),
    ).toEqual({ characterId: "lisa", reason: "manual" });
  });

  it("manual：缺少角色、非成员和静音分别报稳定错误码", () => {
    expect(() => chooseNextSpeaker({ strategy: "manual", members, history: [] })).toThrowError(
      expect.objectContaining<Partial<SpeakerSelectionError>>({ code: "speaker_required" }),
    );
    expect(() =>
      chooseNextSpeaker({ strategy: "manual", members, history: [], speakerId: "nope" }),
    ).toThrowError(
      expect.objectContaining<Partial<SpeakerSelectionError>>({ code: "speaker_not_member" }),
    );
    expect(() =>
      chooseNextSpeaker({
        strategy: "manual",
        members: members.map((member) =>
          member.characterId === "lisa" ? { ...member, muted: true } : member,
        ),
        history: [],
        speakerId: "lisa",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SpeakerSelectionError>>({ code: "speaker_muted" }),
    );
  });

  it("force：允许静音成员发言", () => {
    expect(
      chooseNextSpeaker({
        strategy: "force",
        members: members.map((member) =>
          member.characterId === "lisa" ? { ...member, muted: true } : member,
        ),
        history: [],
        speakerId: "lisa",
      }),
    ).toEqual({ characterId: "lisa", reason: "force" });
  });

  it("list：无历史从首个成员开始，随后按 position 循环", () => {
    expect(chooseNextSpeaker({ strategy: "list", members, history: [] })).toEqual({
      characterId: "aria",
      reason: "list",
    });
    expect(
      chooseNextSpeaker({
        strategy: "list",
        members,
        history: [{ role: "assistant", speakerId: "aria" }],
      }),
    ).toEqual({ characterId: "lisa", reason: "list" });
    expect(
      chooseNextSpeaker({
        strategy: "list",
        members,
        history: [{ role: "assistant", speakerId: "kaeya" }],
      }),
    ).toEqual({ characterId: "aria", reason: "list" });
  });

  it("list：跳过静音成员，上一名被移除时回到第一名可用成员", () => {
    const muted = members.map((member) =>
      member.characterId === "lisa" ? { ...member, muted: true } : member,
    );
    expect(
      chooseNextSpeaker({
        strategy: "list",
        members: muted,
        history: [{ role: "assistant", speakerId: "aria" }],
      }),
    ).toEqual({ characterId: "kaeya", reason: "list" });
    expect(
      chooseNextSpeaker({
        strategy: "list",
        members: muted,
        history: [{ role: "assistant", speakerId: "lisa" }],
      }),
    ).toEqual({ characterId: "aria", reason: "list" });
  });

  it("list：全部静音时拒绝自动选择", () => {
    expect(() =>
      chooseNextSpeaker({
        strategy: "list",
        members: members.map((member) => ({ ...member, muted: true })),
        history: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<SpeakerSelectionError>>({ code: "no_available_speaker" }),
    );
  });
});
