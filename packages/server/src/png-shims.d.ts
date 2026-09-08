/**
 * 测试用 PNG 工具包的类型 shim（与 engine 侧 png-shims.d.ts 同源定义）。
 */

declare module "png-chunk-text" {
  namespace pngChunkText {
    function encode(keyword: string, content: string): { name: "tEXt"; data: Uint8Array };
  }
  export = pngChunkText;
}

declare module "png-chunks-encode" {
  function encodePng(chunks: readonly { name: string; data: Uint8Array }[]): Uint8Array;
  export = encodePng;
}
