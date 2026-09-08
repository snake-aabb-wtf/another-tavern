/**
 * PNG chunk 读取的类型化封装（docs/cards-spec.md §4）。
 * 生产代码只经此模块触碰 png-chunks-extract / png-chunk-text。
 */

import chunkText from "png-chunk-text";
import extractChunks from "png-chunks-extract";

export interface PngChunk {
  name: string;
  data: Uint8Array;
}

/** 解码后的 tEXt chunk 内容。 */
export interface PngTextValue {
  keyword: string;
  text: string;
}

/** 提取 PNG 全部数据 chunk；非法 PNG 会抛异常（调用方负责转错误码）。 */
export function extractPngChunks(png: Uint8Array): PngChunk[] {
  return extractChunks(png);
}

/** 解码一个 tEXt chunk；chunk 内容含非法 0x00 时抛异常。 */
export function decodePngTextChunk(chunk: PngChunk): PngTextValue {
  return chunkText.decode(chunk);
}
