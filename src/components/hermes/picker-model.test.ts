import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyLoad,
  groupSkills,
  initialSelection,
  toggle,
  toggleSkill,
  toggleToolset,
} from "./picker-model";

const ts = (name: string, enabled: boolean) => ({
  name,
  label: name,
  description: "",
  enabled,
  configured: true,
});
const sk = (name: string, category: string, disabled = false, essential = false) => ({
  name,
  category,
  description: `${name} 설명`,
  disabled,
  essential,
});

describe("picker-model", () => {
  it("초기 선택은 서버의 현재 상태다", () => {
    assert.deepEqual(
      initialSelection(
        [ts("web", true), ts("file", false), ts("tts", true)],
        [sk("pdf", "docs", true), sk("xlsx", "docs")],
      ),
      { enabledToolsets: ["tts", "web"], disabledSkills: ["pdf"] },
    );
  });
  it("toggle 은 정렬된 중복 없는 새 배열을 준다", () => {
    const base = ["web"];
    assert.deepEqual(toggle(base, "file", true), ["file", "web"]);
    assert.deepEqual(toggle(base, "web", true), ["web"]);
    assert.deepEqual(toggle(base, "web", false), []);
    assert.deepEqual(base, ["web"]);
  });
  it("스킬은 분류로 묶고 이름·설명으로 거른다", () => {
    const skills = [
      sk("pdf", "docs"),
      sk("xlsx", "docs"),
      sk("hermes-agent", "core"),
      sk("misc", ""),
    ];
    assert.deepEqual(
      groupSkills(skills, "").map((g) => [g.category, g.skills.length]),
      [
        ["", 1],
        ["core", 1],
        ["docs", 2],
      ],
    );
    assert.deepEqual(
      groupSkills(skills, "PDF").map((g) => g.skills.map((s) => s.name)),
      [["pdf"]],
    );
    assert.deepEqual(
      groupSkills(skills, "xlsx 설").map((g) => g.skills.map((s) => s.name)),
      [["xlsx"]],
    );
  });
  it("둘 중 하나라도 업그레이드 필요면 unsupported 다", () => {
    assert.equal(
      classifyLoad([{ errorCode: "plugin_upgrade_required" }, { skills: [] }]),
      "unsupported",
    );
    assert.equal(classifyLoad([{ errorCode: "config_unreadable" }, { skills: [] }]), "error");
    assert.equal(classifyLoad([{ toolsets: [] }, { skills: [] }]), "ok");
  });
  it("툴셋을 바꿀 때 불러온 목록 밖 이름(MCP·모르는 이름)은 싣지 않는다", () => {
    const rows = [ts("web", true), ts("tts", false)];
    assert.deepEqual(toggleToolset(["web", "my-mcp", "ghost"], "tts", true, rows), ["tts", "web"]);
    assert.deepEqual(toggleToolset(["web", "my-mcp"], "web", false, rows), []);
  });
  it("스킬을 바꿀 때 필수·모르는 이름은 끈 목록에 싣지 않는다", () => {
    const rows = [sk("hermes-agent", "core", false, true), sk("pdf", "docs"), sk("xlsx", "docs")];
    assert.deepEqual(toggleSkill(["hermes-agent", "ghost", "xlsx"], "pdf", false, rows), [
      "pdf",
      "xlsx",
    ]);
    assert.deepEqual(toggleSkill(["hermes-agent", "ghost", "xlsx"], "xlsx", true, rows), []);
  });
});
