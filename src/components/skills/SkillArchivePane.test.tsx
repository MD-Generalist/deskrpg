import assert from "node:assert/strict";
import test from "node:test";

import SkillArchivePane from "./SkillArchivePane";
import { createSkillsApi } from "./skills-api";
import {
  $,
  ROOT,
  cleanup,
  click,
  container,
  mockFetch,
  render,
  text,
  type,
} from "./skills-test-harness";

const ARCHIVE = `GET ${ROOT}/archive`;
const archived = { archived: [{ name: "weekly", archivedAt: "2026-09-20T10:00:00Z" }] };

const pane = (canManage: boolean) => (
  <SkillArchivePane
    api={createSkillsApi("ch-1", "n-1")}
    canManage={canManage}
    onChanged={() => {}}
  />
);

test.afterEach(cleanup);

test("목록과 날짜, [복원] 은 POST …/archive/weekly/restore 후 다시 읽는다", async () => {
  const log = mockFetch({
    [ARCHIVE]: archived,
    [`POST ${ROOT}/archive/weekly/restore`]: { name: "weekly" },
  });
  await render(pane(true));
  assert.ok(text().includes("weekly"));
  assert.ok(text().includes("2026-09-20"));
  await click('[data-action="restore"]');
  assert.deepEqual(log.calls, [ARCHIVE, `POST ${ROOT}/archive/weekly/restore`, ARCHIVE]);
});

test("[영구 삭제] 는 이름을 정확히 입력해야 확인 버튼이 켜지고 DELETE …/archive/weekly", async () => {
  const log = mockFetch({
    [ARCHIVE]: archived,
    [`DELETE ${ROOT}/archive/weekly`]: { name: "weekly", ledgerId: "l1" },
  });
  await render(pane(true));
  await click('[data-action="purge"]');
  assert.ok(text().includes("Hermes CLI"));
  assert.equal(($('[data-action="confirm-purge"]') as HTMLButtonElement).disabled, true);
  await type('[name="purge-name"]', "week");
  assert.equal(($('[data-action="confirm-purge"]') as HTMLButtonElement).disabled, true);
  await type('[name="purge-name"]', "weekly");
  await click('[data-action="confirm-purge"]');
  assert.ok(log.calls.includes(`DELETE ${ROOT}/archive/weekly`));
});

test("멤버에게는 복원·영구 삭제 버튼이 없다", async () => {
  mockFetch({ [ARCHIVE]: archived });
  await render(pane(false));
  assert.ok(text().includes("weekly"));
  assert.equal(container.querySelector('[data-action="restore"]'), null);
  assert.equal(container.querySelector('[data-action="purge"]'), null);
});

test("비어 있으면 안내 문구", async () => {
  mockFetch({ [ARCHIVE]: { archived: [] } });
  await render(pane(true));
  assert.ok(text().includes("보관한 스킬이 없습니다"));
});
