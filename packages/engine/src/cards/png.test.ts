import chunkText from "png-chunk-text";
import encodePng from "png-chunks-encode";
import { describe, expect, it } from "vitest";

import { CardParseError } from "./model.js";
import { extractPngChunks } from "./png-codec.js";
import { parseCharacterCardPng } from "./png.js";

/** 在测试内合成一张带 chara tEXt chunk 的最小 PNG（不提交二进制 fixture）。 */
function buildCardPng(keyword: string, cardJson: string): Uint8Array {
  return buildPngWithCharaText(keyword, Buffer.from(cardJson, "utf8").toString("base64"));
}

/** chara chunk 的 text 原样写入（用于构造损坏/异常 payload）。 */
function buildPngWithCharaText(keyword: string, text: string): Uint8Array {
  const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const chunks = [
    { name: "IHDR", data: ihdr },
    chunkText.encode(keyword, text),
    { name: "IDAT", data: new Uint8Array([1, 2, 3, 4]) },
    { name: "IEND", data: new Uint8Array(0) },
  ];
  return encodePng(chunks);
}

const CARD = JSON.stringify({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Aria",
    description: "d",
    personality: "p",
    scenario: "s",
    first_mes: "f",
    mes_example: "",
    extensions: {},
  },
});

describe("parseCharacterCardPng", () => {
  it("round-trip：代码合成含 chara chunk 的 PNG → 解析出卡", () => {
    const png = buildCardPng("chara", CARD);
    const { card, warnings } = parseCharacterCardPng(png);

    expect(warnings).toEqual([]);
    expect(card.name).toBe("Aria");
    expect(card.firstMes).toBe("f");
  });

  it("keyword 大小写不敏感（Chara 也能读）", () => {
    const png = buildCardPng("Chara", CARD);
    const { card } = parseCharacterCardPng(png);

    expect(card.name).toBe("Aria");
  });

  it("V1 数据藏于 PNG → 升级解析 + v1_imported", () => {
    const v1 = JSON.stringify({
      name: "Old",
      description: "d",
      personality: "p",
      scenario: "s",
      first_mes: "f",
      mes_example: "",
    });
    const { card, warnings } = parseCharacterCardPng(buildCardPng("chara", v1));

    expect(card.sourceSpec).toBe("chara_card_v1");
    expect(warnings.map((w) => w.code)).toContain("v1_imported");
  });

  it("多个 tEXt chunk：取 chara，忽略其他 keyword", () => {
    const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const png = encodePng([
      { name: "IHDR", data: ihdr },
      chunkText.encode("comment", "just a comment"),
      chunkText.encode("chara", Buffer.from(CARD, "utf8").toString("base64")),
      { name: "IEND", data: new Uint8Array(0) },
    ]);
    const { card } = parseCharacterCardPng(png);

    expect(card.name).toBe("Aria");
  });

  it("无 chara chunk → png_chunk_not_found", () => {
    const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
    const png = encodePng([
      { name: "IHDR", data: ihdr },
      chunkText.encode("comment", "no card here"),
      { name: "IEND", data: new Uint8Array(0) },
    ]);

    try {
      parseCharacterCardPng(png);
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("png_chunk_not_found");
    }
  });

  it("非法 PNG 字节 → invalid_png", () => {
    try {
      parseCharacterCardPng(new Uint8Array([1, 2, 3]));
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("invalid_png");
    }
  });

  it("CRC 损坏（篡改 IDAT）→ invalid_png", () => {
    const png = buildCardPng("chara", CARD);
    const chunks = extractPngChunks(png);
    const textLen = chunks.find((c) => c.name === "tEXt")?.data.length ?? 0;
    const corrupt = Uint8Array.from(png);
    // PNG 结构：8 签名 + [4 len][4 name][data][4 crc]…
    const idatDataStart = 8 + (12 + 13) + (12 + textLen) + 8; // +8: IDAT 的 len+name
    corrupt[idatDataStart] = (corrupt[idatDataStart] ?? 0) ^ 0xff;

    try {
      parseCharacterCardPng(corrupt);
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("invalid_png");
    }
  });

  it("chara 值非合法 base64 → base64_decode_failed", () => {
    const png = buildPngWithCharaText("chara", "!!!not base64!!!");

    try {
      parseCharacterCardPng(png);
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("base64_decode_failed");
    }
  });

  it("base64 合法但内容非 JSON → json_parse_failed", () => {
    const png = buildPngWithCharaText(
      "chara",
      Buffer.from("plain text not json", "utf8").toString("base64"),
    );

    try {
      parseCharacterCardPng(png);
      expect.unreachable();
    } catch (e) {
      expect((e as CardParseError).code).toBe("json_parse_failed");
    }
  });
});
