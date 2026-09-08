/**
 * PNG 角色卡解析（docs/cards-spec.md §4）。
 * 输入为 PNG 文件字节（Buffer/Uint8Array）；引擎自身不做任何文件 IO。
 */

import { parseCharacterCardJson } from "./json.js";
import { CardParseError, type ParseCardResult } from "./model.js";
import { decodePngTextChunk, extractPngChunks } from "./png-codec.js";

const CHARA_KEYWORD = "chara";

/**
 * 从 PNG 的 tEXt chunk（keyword=chara，值 base64(JSON)）解析角色卡。
 * keyword 查找大小写不敏感（cards-spec §4 宽容导入）。
 */
export function parseCharacterCardPng(png: Uint8Array): ParseCardResult {
  let chunks;
  try {
    chunks = extractPngChunks(png);
  } catch {
    throw new CardParseError(
      "invalid_png",
      "PNG structure invalid (bad signature / IHDR order / CRC mismatch / truncated).",
    );
  }

  for (const chunk of chunks) {
    if (chunk.name !== "tEXt") {
      continue;
    }
    let keyword: string;
    let text: string;
    try {
      ({ keyword, text } = decodePngTextChunk(chunk));
    } catch {
      continue; // 畸形 tEXt chunk：跳过，继续找 chara
    }
    if (keyword.toLowerCase() !== CHARA_KEYWORD) {
      continue;
    }
    return parseCharacterCardJson(decodeBase64Utf8(text));
  }

  throw new CardParseError("png_chunk_not_found", `No tEXt chunk with keyword "${CHARA_KEYWORD}".`);
}

/** canonical base64（Node 的 atob 对非法字符宽容，导入前必须自行校验）。 */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeBase64Utf8(b64: string): string {
  if (!CANONICAL_BASE64.test(b64)) {
    throw new CardParseError("base64_decode_failed", "chara chunk is not valid base64.");
  }
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    throw new CardParseError("base64_decode_failed", "chara chunk is not valid base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}
