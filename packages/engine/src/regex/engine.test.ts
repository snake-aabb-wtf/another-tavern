import { describe, expect, it } from "vitest";

import { applyRegexScripts, normalizeRegexScript, normalizeRegexScripts } from "./engine.js";
import type { RegexScript } from "./model.js";

const script = (patch: Partial<RegexScript>): RegexScript => ({
  id: "r1",
  scriptName: "rule",
  findRegex: "/foo/g",
  replaceString: "bar",
  trimStrings: [],
  placement: ["prompt"],
  disabled: false,
  markdownOnly: false,
  promptOnly: false,
  runOnEdit: false,
  substituteRegex: "none",
  minDepth: null,
  maxDepth: null,
  ...patch,
});

describe("regex scripts", () => {
  it("按数组顺序执行全局替换", () => {
    const result = applyRegexScripts(
      "foo baz",
      [
        script({ findRegex: "/foo/g", replaceString: "one" }),
        script({ id: "r2", findRegex: "/baz/g", replaceString: "two" }),
      ],
      "prompt",
    );
    expect(result.text).toBe("one two");
    expect(result.appliedScriptIds).toEqual(["r1", "r2"]);
  });

  it("支持数字捕获组、命名捕获组和 {{match}}", () => {
    const result = applyRegexScripts(
      "姓名：Aria",
      [
        script({
          findRegex: "/姓名：(?<name>\\w+)/g",
          replaceString: "角色={{match}}，名字=$<name>，副本=$1",
        }),
      ],
      "prompt",
    );
    expect(result.text).toBe("角色=姓名：Aria，名字=Aria，副本=Aria");
  });

  it("支持 trimStrings、禁用规则和作用位置过滤", () => {
    const result = applyRegexScripts(
      "<think>secret</think> visible",
      [
        script({
          findRegex: "/secret/g",
          replaceString: "shown",
          trimStrings: ["<think>", "</think>"],
          placement: ["aiOutput"],
        }),
        script({ id: "disabled", disabled: true }),
      ],
      "aiOutput",
    );
    expect(result.text).toBe("<think>shown</think> visible");
    expect(applyRegexScripts("foo", [script({ placement: ["prompt"] })], "aiOutput").text).toBe(
      "foo",
    );
  });

  it("非法表达式产生告警而不阻断后续规则", () => {
    const result = applyRegexScripts(
      "foo",
      [
        script({ findRegex: "/[/g" }),
        script({ id: "r2", findRegex: "/foo/g", replaceString: "ok" }),
      ],
      "prompt",
    );
    expect(result.text).toBe("ok");
    expect(result.warnings).toEqual(["regex_invalid:r1"]);
  });

  it("支持 ST 数字 placement 与 snake_case 导入字段", () => {
    const normalized = normalizeRegexScript(
      {
        id: "st-1",
        script_name: "脱壳",
        find_regex: "/foo/g",
        replace_string: "bar",
        placement: [2],
        prompt_only: true,
        substitute_regex: 2,
      },
      "fallback",
    );
    expect(normalized.warnings).toEqual([]);
    expect(normalized.script).toMatchObject({
      id: "st-1",
      scriptName: "脱壳",
      placement: ["aiOutput"],
      promptOnly: true,
      substituteRegex: "escaped",
    });
  });

  it("数组规范化会忽略坏脚本但保留告警", () => {
    const result = normalizeRegexScripts(
      [null, { id: "ok", findRegex: "x", placement: ["prompt"] }],
      "card",
    );
    expect(result.scripts).toHaveLength(1);
    expect(result.warnings).toEqual(["regex_invalid_script:card:0"]);
  });
});
