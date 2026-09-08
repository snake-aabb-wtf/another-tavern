/**
 * CJS 依赖的类型 shim（png-* 三件套无官方类型）。
 * 仅声明用到的子集；png-chunks-encode 只在测试 fixture 合成中使用。
 */

declare module "png-chunks-extract" {
  interface PngChunk {
    name: string;
    data: Uint8Array;
  }
  function extractChunks(data: Uint8Array): PngChunk[];
  export = extractChunks;
}

declare module "png-chunk-text" {
  namespace pngChunkText {
    function encode(keyword: string, content: string): { name: "tEXt"; data: Uint8Array };
    function decode(chunk: { name: string; data: Uint8Array } | Uint8Array): {
      keyword: string;
      text: string;
    };
  }
  export = pngChunkText;
}

declare module "png-chunks-encode" {
  function encodePng(chunks: readonly { name: string; data: Uint8Array }[]): Uint8Array;
  export = encodePng;
}
