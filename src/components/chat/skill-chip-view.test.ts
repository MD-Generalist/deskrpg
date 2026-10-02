import assert from "node:assert/strict";
import test from "node:test";

import type { SkillListView } from "@/components/skills/skills-api";
import {
  chatSkillsFrom,
  leadingMentionName,
  roomSkillTarget,
  skillInputProps,
  splitSkillBubble,
} from "./skill-chip-view";

const row = (name: string, disabled = false) => ({
  name,
  category: "",
  description: `${name} desc`,
  disabled,
  essential: false,
});
const view = (extra: Record<string, unknown> = {}): SkillListView =>
  ({
    skills: [row("research"), row("write-report"), row("off", true)],
    canManage: false,
    capabilityReady: true,
    sharedChannelCount: 1,
    ...extra,
  }) as SkillListView;

test("chat candidates are the skills that are on, and invocation follows the list flag", () => {
  const on = chatSkillsFrom(view({ skillInvocation: true }));
  assert.deepEqual(
    on.candidates.map((c) => c.name),
    ["research", "write-report"],
  );
  assert.deepEqual(on.known, ["research", "write-report", "off"]);
  assert.equal(on.invocation, true);
  assert.equal(chatSkillsFrom(view()).invocation, false);
});

test("input props: unknown keeps '/' plain, an older plugin blocks, a ready one lists", () => {
  assert.deepEqual(skillInputProps(undefined), {});
  assert.deepEqual(skillInputProps({ candidates: [], known: [], invocation: false }), {
    skillsBlockedReason: "plugin_update",
  });
  const candidates = [{ name: "research", description: "" }];
  assert.deepEqual(skillInputProps({ candidates, known: ["research"], invocation: true }), {
    skillCandidates: candidates,
  });
});

test("a room draft has a skill target only when it names exactly one employee", () => {
  const people = [
    { id: "n1", name: "Sophie" },
    { id: "n2", name: "Oliver" },
  ];
  const sophie = { kind: "mention" as const, id: "n1", name: "Sophie" };
  const oliver = { kind: "mention" as const, id: "n2", name: "Oliver" };
  assert.equal(roomSkillTarget([{ kind: "text", text: "hi" }], people), null);
  assert.equal(roomSkillTarget([sophie, { kind: "text", text: " go" }], people), "n1");
  assert.equal(roomSkillTarget([sophie, sophie], people), "n1");
  assert.equal(roomSkillTarget([sophie, oliver], people), null);
});

test("a sent line splits into chips only for names the employee has", () => {
  const known = new Set(["research", "write-report"]);
  assert.deepEqual(splitSkillBubble("/research /write-report do it", known), {
    prefix: "",
    skills: ["research", "write-report"],
    instruction: "do it",
  });
  assert.equal(splitSkillBubble("/tmp 폴더 정리해", known), null);
  assert.equal(splitSkillBubble("/research go", null), null, "list not loaded: drawn as written");
});

test("a room line keeps its leading mention before the chips", () => {
  const known = new Set(["research"]);
  assert.deepEqual(splitSkillBubble("@[Sophie] /research go", known, { mention: true }), {
    prefix: "@[Sophie] ",
    skills: ["research"],
    instruction: "go",
  });
  assert.equal(splitSkillBubble("/research go", known, { mention: true }), null);
  assert.equal(leadingMentionName("@[So\\]phie] /research"), "So]phie");
  assert.equal(leadingMentionName("hello"), null);
});
