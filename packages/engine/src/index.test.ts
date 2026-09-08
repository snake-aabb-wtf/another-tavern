import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ENGINE_VERSION } from "./index.js";

describe("engine smoke test", () => {
  it("exposes a non-empty version constant", () => {
    expect(typeof ENGINE_VERSION).toBe("string");
    expect(ENGINE_VERSION.length).toBeGreaterThan(0);
  });

  it("keeps ENGINE_VERSION in sync with package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    };

    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});
