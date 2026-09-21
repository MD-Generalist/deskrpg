import assert from "node:assert/strict";
import test from "node:test";

import type { ArtifactSummary } from "@/lib/hermes/deskrpg-plugin-types";

import { visibleCardAttachments, type GalleryAttachment } from "./card-attachments";

const file = (
  id: string,
  taskId: string,
  filename: string,
  title: string | null = "주간 보고",
): GalleryAttachment => ({
  id,
  filename,
  size: 1,
  task_id: taskId,
  task_title: title,
  boardSlug: "b1",
});

const artifact = (taskId: string | null, filename: string): ArtifactSummary => ({
  id: `art-${filename}`,
  kind: "document",
  title: filename,
  profile: "sophie",
  source_kind: "kanban",
  session_id: "s",
  task_id: taskId,
  current_version: 1,
  filename,
  mime: "text/markdown",
  size: 1,
  sha256: "x",
  created_at: 1,
  updated_at: 1,
});

test("같은 카드의 같은 파일이 아티팩트로도 잡혔으면 첨부는 빼고 아티팩트만 남긴다", () => {
  const out = visibleCardAttachments(
    [file("a1", "t1", "report.md"), file("a2", "t1", "raw.csv")],
    [artifact("t1", "report.md")],
    {},
    null,
  );
  assert.deepEqual(
    out.map((a) => a.id),
    ["a2"],
    "같은 문서가 갤러리에 두 번 나온다",
  );
});

test("파일명이 같아도 다른 카드의 것이면 둘 다 보여 준다", () => {
  const out = visibleCardAttachments(
    [file("a1", "t2", "report.md")],
    [artifact("t1", "report.md")],
    {},
    null,
  );
  assert.equal(out.length, 1);
});

test("종류·출처·직원 필터가 걸리면 근거가 없는 첨부는 보여 주지 않는다 — 파일 탭은 예외", () => {
  const all = [file("a1", "t1", "x.md")];
  assert.equal(visibleCardAttachments(all, [], { category: "media" }, null).length, 0);
  assert.equal(visibleCardAttachments(all, [], { source: "chat" }, null).length, 0);
  assert.equal(visibleCardAttachments(all, [], { profile: "sophie" }, null).length, 0);
  assert.equal(visibleCardAttachments(all, [], { category: "file" }, null).length, 1);
});

test("카드에서 열면 그 카드의 첨부만, 검색어는 파일명과 카드 제목에서 찾는다", () => {
  const all = [
    file("a1", "t1", "report.md", "주간 보고"),
    file("a2", "t2", "data.csv", "매출 정리"),
  ];
  assert.deepEqual(
    visibleCardAttachments(all, [], {}, "t2").map((a) => a.id),
    ["a2"],
  );
  assert.deepEqual(
    visibleCardAttachments(all, [], { q: "매출" }, null).map((a) => a.id),
    ["a2"],
  );
  assert.deepEqual(
    visibleCardAttachments(all, [], { q: "REPORT" }, null).map((a) => a.id),
    ["a1"],
  );
});

test("카드가 지워져 제목이 null 이어도 견딘다", () => {
  const out = visibleCardAttachments([file("a1", "t9", "orphan.md", null)], [], { q: "zzz" }, null);
  assert.deepEqual(out, []);
});
