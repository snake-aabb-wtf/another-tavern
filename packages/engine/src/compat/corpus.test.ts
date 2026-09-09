/**
 * M7 兼容性批量测试：合成语料全量导入，锁定"能导入"与"预期失败"。
 * PNG 样例在测试内合成字节（无二进制 fixture）。
 */
import chunkText from "png-chunk-text";
import encodePng from "png-chunks-encode";
import { describe, expect, it } from "vitest";

import { CARD_CASES, CARD_PNG_CASES, PRESET_CASES, WORLD_CASES, pngCardPayload } from "./corpus.js";
import { parseCharacterCardJson } from "../cards/json.js";
import { parseCharacterCardPng } from "../cards/png.js";
import { parseOpenAiPreset } from "../assembly/parse-preset.js";
import { parseSillyTavernWorldInfo } from "../worldinfo/parse-native.js";

function buildCardPng(base64: string): Uint8Array {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return encodePng([
    { name: "IHDR", data: ihdr },
    chunkText.encode("chara", base64),
    { name: "IDAT", data: new Uint8Array([1]) },
    { name: "IEND", data: new Uint8Array(0) },
  ]);
}

function expectOk(result: () => unknown): void {
  expect(() => result()).not.toThrow();
}

function expectFail(result: () => unknown, code: string): void {
  try {
    result();
    expect.unreachable(`预期失败（${code}）但成功导入`);
  } catch (e) {
    expect((e as { code?: string }).code).toBe(code);
  }
}

describe("M7 兼容性语料：角色卡 JSON（12 份）", () => {
  for (const item of CARD_CASES) {
    it(`${item.id}：${item.note ?? ""}`, () => {
      const run = (): unknown => parseCharacterCardJson(item.payload);
      if (item.expect === "ok") {
        expectOk(run);
      } else {
        expectFail(run, item.errorCode ?? "unknown");
      }
    });
  }
});

describe("M7 兼容性语料：角色卡 PNG（4 份，代码合成）", () => {
  for (const item of CARD_PNG_CASES) {
    it(`${item.id}：${item.note ?? ""}`, () => {
      const run = (): unknown => parseCharacterCardPng(buildCardPng(item.payload));
      if (item.expect === "ok") {
        expectOk(run);
      } else {
        expectFail(run, item.errorCode ?? "unknown");
      }
    });
  }

  it("PNG 语料 sanity：base64 载荷与 JSON 路径产物一致", () => {
    const card = JSON.stringify({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name: "P",
        description: "",
        personality: "",
        scenario: "",
        first_mes: "",
        mes_example: "",
        extensions: {},
      },
    });
    const fromPng = parseCharacterCardPng(buildCardPng(pngCardPayload(card)));
    const fromJson = parseCharacterCardJson(card);
    expect(fromPng.card).toEqual(fromJson.card);
  });
});

describe("M7 兼容性语料：ST 原生世界书（12 份）", () => {
  for (const item of WORLD_CASES) {
    it(`${item.id}：${item.note ?? ""}`, () => {
      const run = (): unknown => parseSillyTavernWorldInfo(item.payload);
      if (item.expect === "ok") {
        expectOk(run);
      } else {
        expectFail(run, item.errorCode ?? "unknown");
      }
    });
  }
});

describe("M7 兼容性语料：ST OpenAI 预设（12 份）", () => {
  for (const item of PRESET_CASES) {
    it(`${item.id}：${item.note ?? ""}`, () => {
      const run = (): unknown => parseOpenAiPreset(item.payload);
      if (item.expect === "ok") {
        expectOk(run);
      } else {
        expectFail(run, item.errorCode ?? "unknown");
      }
    });
  }
});
