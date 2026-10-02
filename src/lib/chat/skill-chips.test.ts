import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SKILL_CHIPS,
  formatSkillChipLine,
  normalizeSkillName,
  parseSkillChipLine,
} from "./skill-chips";

test("normalizeSkillName strips a leading slash and rejects unsafe names", () => {
  assert.equal(normalizeSkillName("/research"), "research");
  assert.equal(normalizeSkillName("  write-report "), "write-report");
  assert.equal(normalizeSkillName("a b"), null);
  assert.equal(normalizeSkillName("../x"), null);
  assert.equal(normalizeSkillName("a..b"), null);
  assert.equal(normalizeSkillName(""), null);
});

test("formatSkillChipLine writes the TUI shape", () => {
  assert.equal(
    formatSkillChipLine(["research", "write-report"], "summarize this week"),
    "/research /write-report summarize this week",
  );
  assert.equal(formatSkillChipLine(["research"], "  "), "/research");
});

test("parseSkillChipLine only treats known leading tokens as chips", () => {
  const known = new Set(["research", "write-report"]);
  assert.deepEqual(parseSkillChipLine("/research /write-report do it", known), {
    skills: ["research", "write-report"],
    instruction: "do it",
  });
  assert.deepEqual(parseSkillChipLine("/tmp clean the folder", known), {
    skills: [],
    instruction: "/tmp clean the folder",
  });
  assert.deepEqual(parseSkillChipLine("/research /tmp go", known), {
    skills: ["research"],
    instruction: "/tmp go",
  });
  assert.deepEqual(parseSkillChipLine("/research", known), {
    skills: ["research"],
    instruction: "",
  });
  assert.deepEqual(parseSkillChipLine("plain text", known), {
    skills: [],
    instruction: "plain text",
  });
});

test("parseSkillChipLine stops at the chip limit and at a repeat", () => {
  const names = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const out = parseSkillChipLine(names.map((n) => "/" + n).join(" ") + " go", new Set(names));
  assert.equal(out.skills.length, MAX_SKILL_CHIPS);
  assert.equal(out.instruction, "/a6 go");
  assert.deepEqual(parseSkillChipLine("/a1 /a1 go", new Set(names)), {
    skills: ["a1"],
    instruction: "/a1 go",
  });
});

test("format then parse round-trips", () => {
  const known = new Set(["research", "write-report"]);
  const line = formatSkillChipLine(["research", "write-report"], "/tmp tidy up");
  assert.deepEqual(parseSkillChipLine(line, known), {
    skills: ["research", "write-report"],
    instruction: "/tmp tidy up",
  });
});
