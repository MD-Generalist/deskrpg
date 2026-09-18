import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { createOwnerPluginClient } from "./plugin-client";
import { startFakePluginServer, type FakePluginServer } from "./fake-plugin-server";

const OWNER = "owner-key-1234567890";
let server: FakePluginServer;

before(async () => {
  server = await startFakePluginServer({
    ownerToken: OWNER,
    profileTokens: { sophie: "p-1234567890" },
  });
});
after(async () => server.close());

const client = () => createOwnerPluginClient({ baseUrl: server.baseUrl, ownerToken: OWNER });

test("목록은 profiles·board·taskId 를 쿼리로 보내고 페이지를 돌려준다", async () => {
  server.seedArtifact({
    id: "a1",
    title: "보고서",
    profile: "sophie",
    board: "b1",
    task_id: "t1",
    body: "# hi",
  });
  const res = await client().artifacts.list({
    profiles: ["sophie"],
    board: "b1",
    taskId: "t1",
    limit: 10,
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(
    res.data.artifacts.map((a) => a.id),
    ["a1"],
  );
  assert.match(server.lastRequest()!.path, /profiles=sophie&board=b1.*task_id=t1/);
});

test("content 는 원시 Response 를 주고 Range 를 전달한다", async () => {
  server.seedArtifact({ id: "a2", title: "t", profile: "sophie", body: "0123456789" });
  const res = await client().artifacts.content("a2", 1, { range: "bytes=2-5" });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.response.status, 206);
  assert.equal(await res.response.text(), "2345");
  assert.equal(res.response.headers.get("content-security-policy"), "sandbox");
});

test("content 실패는 PluginFailure 로 접힌다", async () => {
  const res = await client().artifacts.content("nope", 1, {});
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.status, 404);
  assert.equal(res.failure.code, "artifact_not_found");
});

test("addVersion·remove 는 X-DeskRPG-User 를 붙인다", async () => {
  server.seedArtifact({ id: "a3", title: "t", profile: "sophie", body: "v1" });
  const added = await client().artifacts.addVersion(
    "a3",
    { content: "v2", filename: "t.md" },
    "user-1",
  );
  assert.equal(added.ok, true);
  assert.equal(server.lastRequest()!.headers["x-deskrpg-user"], "user-1");
  const removed = await client().artifacts.remove("a3", "user-1");
  assert.equal(removed.ok, true);
});

test("events.poll 은 include 를 쿼리로 보낸다", async () => {
  await client().events.poll({ board: "b1", include: "artifacts" });
  assert.match(server.lastRequest()!.path, /include=artifacts/);
});

test("첨부 바이트는 attachmentContent 로 스트림된다", async () => {
  const board = server.seedAttachment({
    board: "b1",
    taskId: "t1",
    filename: "a.txt",
    body: "hello",
  });
  const res = await client().kanban.attachmentContent("b1", board.id, {});
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(await res.response.text(), "hello");
});
