/** M6 store 测试：plans 导入/保存、lorebooks 导入/条目/挂载。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlanData } from "../api/plans.js";
import { usePlansStore } from "./plans.js";
import { useLorebooksStore } from "./lorebooks.js";

const SAMPLE_PRESET = {
  name: "P",
  prompts: [
    { identifier: "main", marker: false },
    { identifier: "chatHistory", marker: true },
  ],
  prompt_order: [
    {
      character_id: 100001,
      order: [
        { identifier: "main", enabled: true },
        { identifier: "chatHistory", enabled: true },
      ],
    },
  ],
};

const SAMPLE_WI = {
  name: "W",
  entries: {
    "0": {
      uid: 0,
      key: ["x"],
      content: "C",
      constant: true,
      order: 10,
      position: 0,
      disable: false,
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

function fileWith(content: string): File {
  return new File([content], "sample.json", { type: "application/json" });
}

describe("plans store", () => {
  beforeEach(() => {
    usePlansStore.setState({
      items: [],
      current: null,
      lastImport: null,
      loading: false,
      error: null,
    });
  });

  it("导入 ST 预设 → 摘要含启用/禁用槽位与映射结果", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("/api/plans/import")) {
          return textResponse(
            JSON.stringify({
              id: "p1",
              name: "P",
              plan: {
                id: "p1",
                name: "P",
                systemSlots: [
                  { id: "main", enabled: true, order: 10, source: "default", content: "" },
                  { id: "persona", enabled: false, order: 20, source: "default", content: "" },
                ],
                postHistory: { enabled: true, position: "historyAfter" },
                extensions: { unmappedPrompts: [{ identifier: "chatHistory" }] },
                unknownFields: {},
              },
              warnings: ["feature_unsupported:prompt:chatHistory"],
            }),
          );
        }
        if (url.endsWith("/api/plans")) {
          return jsonResponse([{ id: "p1", name: "P", createdAt: "", updatedAt: "" }]);
        }
        return jsonResponse({ error: { code: "no_route", message: url } }, 404);
      }),
    );

    await usePlansStore.getState().importPresetFile(fileWith(JSON.stringify(SAMPLE_PRESET)));

    const summary = usePlansStore.getState().lastImport;
    expect(summary?.enabledSlots).toEqual(["main"]);
    expect(summary?.disabledSlots).toEqual(["persona"]);
    expect(summary?.droppedFields).toContain("feature_unsupported:prompt:chatHistory");
    expect(summary?.droppedFields).toContain("unmapped:chatHistory");
    expect(usePlansStore.getState().items).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it("save：PUT 更新计划并刷新当前详情", async () => {
    let currentName = "n1";
    const planData: PlanData = {
      id: "p1",
      name: "n1",
      systemSlots: [],
      postHistory: { enabled: true, position: "historyAfter" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/plans/p1" && init?.method === "PUT") {
          const body = JSON.parse(String(init.body)) as { plan?: { name?: string } };
          currentName = body.plan?.name ?? currentName;
          return jsonResponse({
            id: "p1",
            name: currentName,
            plan: { ...planData, name: currentName },
          });
        }
        if (url === "/api/plans/p1") {
          return jsonResponse({
            id: "p1",
            name: currentName,
            plan: { ...planData, name: currentName },
            createdAt: "",
            updatedAt: "",
          });
        }
        if (url === "/api/plans") {
          return jsonResponse([{ id: "p1", name: currentName, createdAt: "", updatedAt: "" }]);
        }
        return jsonResponse({ error: { code: "no_route", message: url } }, 404);
      }),
    );

    await usePlansStore.getState().save("p1", { name: "n2", plan: { ...planData, name: "n2" } });
    expect(usePlansStore.getState().items[0]?.name).toBe("n2");
    vi.unstubAllGlobals();
  });
});

describe("lorebooks store", () => {
  beforeEach(() => {
    useLorebooksStore.setState({
      items: [],
      current: null,
      linkedCharacterIds: [],
      lastImport: null,
      loading: false,
      error: null,
    });
  });

  it("导入 ST 世界书 → 书+条目入库，摘要含条目数", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes("/api/lorebooks/import")) {
          return jsonResponse({ id: "b1", name: "W", entryCount: 1, warnings: [] });
        }
        if (url === "/api/lorebooks") {
          return jsonResponse([
            { id: "b1", name: "W", description: "", isGlobal: false, createdAt: "" },
          ]);
        }
        if (url.includes("/api/lorebooks/b1")) {
          return jsonResponse({
            id: "b1",
            name: "W",
            description: "",
            isGlobal: false,
            createdAt: "",
            entries: [
              {
                id: "0",
                comment: "",
                keys: ["x"],
                secondaryKeys: [],
                selective: false,
                logic: "andAny",
                content: "C",
                enabled: true,
                constant: true,
                insertionOrder: 10,
                position: "beforeChar",
                depth: null,
                role: null,
                scanDepth: null,
                caseSensitive: null,
                matchWholeWords: null,
                preventRecursion: false,
                excludeRecursion: false,
                extensions: {},
              },
            ],
          });
        }
        return jsonResponse({ error: { code: "no_route", message: url } }, 404);
      }),
    );

    await useLorebooksStore.getState().importBook(fileWith(JSON.stringify(SAMPLE_WI)), false);

    const summary = useLorebooksStore.getState().lastImport;
    expect(summary?.entryCount).toBe(1);
    expect(useLorebooksStore.getState().current?.entries[0]?.content).toBe("C");
    vi.unstubAllGlobals();
  });

  it("toggleCharacterLink：未挂载 → 挂载（PUT 全量集合）", async () => {
    useLorebooksStore.setState({
      current: {
        id: "b1",
        name: "W",
        description: "",
        isGlobal: false,
        tokenBudget: null,
        scanDepth: null,
        recursiveScanning: null,
        createdAt: "",
        entries: [],
      },
    });
    let linked = false;
    const putCalls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/api/characters/c1/lorebooks")) {
          if (init?.method === "PUT") {
            putCalls.push(String(init.body));
            linked = true;
            return jsonResponse({ bookIds: ["b1"] });
          }
          return jsonResponse({ bookIds: linked ? ["b1"] : [] });
        }
        if (url === "/api/characters") {
          return jsonResponse([{ id: "c1", name: "Aria", createdAt: "" }]);
        }
        return jsonResponse({ error: { code: "no_route", message: url } }, 404);
      }),
    );

    await useLorebooksStore.getState().toggleCharacterLink("c1");

    expect(putCalls).toHaveLength(1);
    expect(JSON.parse(putCalls[0] ?? "{}")).toEqual({ bookIds: ["b1"] });
    expect(useLorebooksStore.getState().linkedCharacterIds).toEqual(["c1"]);
    vi.unstubAllGlobals();
  });
});
