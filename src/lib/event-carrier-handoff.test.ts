import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { setupThrowawaySqlite, seedChannel, seedGateway, seedUser } from "@/test-setup/npc-seed";
import { startFakePluginServer, type FakePluginServer } from "@/lib/hermes/fake-plugin-server";
const sqlitePath = setupThrowawaySqlite("event-carrier-handoff");
const servers: FakePluginServer[] = [];
after(async () => {
  await Promise.all(servers.map((s) => s.close()));
});

async function fixture() {
  const server = await startFakePluginServer({
    ownerToken: "gateway-owner-key-1234567890",
    profileTokens: {},
  });
  servers.push(server);
  const user = await seedUser("handoff");
  const gateway = await seedGateway(user.id, server.baseUrl);
  const channel = await seedChannel(user.id, "handoff");
  const { bindGatewayToChannel } = await import("./gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: user.id,
  });
  const { ensureChannelBoard, listChannelBoards } = await import("./kanban-boards");
  await ensureChannelBoard(channel.id, undefined, "handoff-second");
  const [source, target] = await listChannelBoards(channel.id);
  const { ensureProjectRow } = await import("./project-registry");
  const project = await ensureProjectRow(source);
  await ensureProjectRow(target);
  return { server, channel, gateway, source, target, project };
}

// 중간 쓰기 뒤 재시작된 DB 상태를 직접 만든다. 복구는 네트워크 없이 저장된 합성 토큰만 사용해야 한다.
for (const phase of ["prepared", "demoted", "promoted", "archived"] as const) {
  test(`인계 ${phase} 뒤 재시작은 저장한 커서로 보관을 끝낸다`, async () => {
    const f = await fixture();
    const { db, channelKanbanBoards, channelProjects } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const journal = {
      version: 1,
      operationId: "op-1",
      channelId: f.channel.id,
      gatewayId: f.gateway.id,
      sourceId: f.source.id,
      targetId: f.target.id,
      sourceCursor: "source-cursor",
      targetCursorBefore: "target-cursor",
      mergedCursor: "merged-cursor",
      projectId: f.project.id,
      requestedStatus: "completed",
    };
    await db
      .update(channelKanbanBoards)
      .set({
        eventCursor: journal.sourceCursor,
        isEventCarrier: phase === "prepared",
        eventCarrierHandoffJson: JSON.stringify(journal),
      })
      .where(eq(channelKanbanBoards.id, f.source.id));
    const promoted = phase === "promoted" || phase === "archived";
    await db
      .update(channelKanbanBoards)
      .set({
        eventCursor: promoted ? journal.mergedCursor : journal.targetCursorBefore,
        isEventCarrier: promoted,
      })
      .where(eq(channelKanbanBoards.id, f.target.id));
    if (phase === "archived")
      await db
        .update(channelProjects)
        .set({ status: "completed" })
        .where(eq(channelProjects.id, f.project.id));
    const { recoverEventCarrierHandoff } = await import("./event-carrier-handoff");
    // 별도 프로세스에서 DB를 다시 연다. 메모리 상태에 기대는 복구는 통과하지 못한다.
    const childEnv = { ...process.env };
    delete childEnv.DATABASE_URL;
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import { recoverEventCarrierHandoff } from './src/lib/event-carrier-handoff.ts'; await recoverEventCarrierHandoff(${JSON.stringify(f.channel.id)});`,
      ],
      { cwd: process.cwd(), env: childEnv, stdio: "pipe" },
    );
    await recoverEventCarrierHandoff(f.channel.id);
    const { listChannelBoards } = await import("./kanban-boards");
    const rows = await listChannelBoards(f.channel.id);
    assert.equal(rows.filter((r) => r.isEventCarrier).length, 1);
    assert.equal(rows.find((r) => r.isEventCarrier)?.eventCursor, "merged-cursor");
    assert.ok(rows.every((r) => r.eventCarrierHandoffJson === null));
    const { readProject } = await import("./project-registry");
    assert.equal((await readProject(f.channel.id, f.project.id)).status, "completed");
  });
}

test("인계 기록 없이 carrier 0인 저장 커서는 임의 승격하지 않는다", async () => {
  const f = await fixture();
  const { db, channelKanbanBoards } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(channelKanbanBoards)
    .set({ isEventCarrier: false, eventCursor: "saved" })
    .where(eq(channelKanbanBoards.id, f.source.id));
  const { ensureChannelCarrier, listChannelBoards } = await import("./kanban-boards");
  await assert.rejects(() => ensureChannelCarrier(f.channel.id), {
    code: "event_carrier_origin_unknown",
  });
  assert.ok((await listChannelBoards(f.channel.id)).every((r) => !r.isEventCarrier));
});

for (const code of ["malformed", "cursor_changed", "gateway_changed"] as const) {
  test(`손상된 인계 ${code}는 원문을 보존하고 오류를 남긴다`, async () => {
    const f = await fixture();
    const { db, channelKanbanBoards } = await import("@/db");
    const { eq } = await import("drizzle-orm");
    const raw =
      code === "malformed"
        ? "{not-json"
        : JSON.stringify({
            version: 1,
            operationId: "op",
            channelId: f.channel.id,
            gatewayId: code === "gateway_changed" ? "other-gateway" : f.gateway.id,
            sourceId: f.source.id,
            targetId: f.target.id,
            sourceCursor: "source",
            targetCursorBefore: code === "cursor_changed" ? "unexpected" : null,
            mergedCursor: "merged",
            projectId: f.project.id,
            requestedStatus: "completed",
          });
    await db
      .update(channelKanbanBoards)
      .set({ eventCursor: "source", eventCarrierHandoffJson: raw })
      .where(eq(channelKanbanBoards.id, f.source.id));
    const { recoverEventCarrierHandoff } = await import("./event-carrier-handoff");
    await assert.rejects(() => recoverEventCarrierHandoff(f.channel.id), {
      code: "event_carrier_handoff_conflict",
    });
    const { listChannelBoards } = await import("./kanban-boards");
    const source = (await listChannelBoards(f.channel.id)).find((r) => r.id === f.source.id)!;
    assert.equal(source.eventCarrierHandoffJson, raw);
    assert.equal(source.eventCursor, "source");
    assert.equal(source.isEventCarrier, true);
    assert.equal(source.lastError, "event_carrier_handoff_conflict");
  });
}

test("구버전 합성 라우트 부재는 carrier와 프로젝트 상태를 그대로 둔다", async () => {
  const f = await fixture();
  f.server.setInfo({ capabilities: ["kanban", "cron", "events"] });
  const { archiveChannelProject, readProject } = await import("./project-registry");
  await assert.rejects(() => archiveChannelProject(f.channel.id, f.project.id, "completed"), {
    status: 428,
    code: "event_cursor_handoff_required",
  });
  const { listChannelBoards } = await import("./kanban-boards");
  const rows = await listChannelBoards(f.channel.id);
  assert.equal(rows.find((r) => r.isEventCarrier)?.id, f.source.id);
  assert.ok(rows.every((r) => r.eventCarrierHandoffJson === null));
  assert.equal((await readProject(f.channel.id, f.project.id)).status, "planned");
});

test("보관 HTTP 오류는 코드와 상태를 전달하고 인계 기록은 응답에 싣지 않는다", async () => {
  const f = await fixture();
  f.server.setInfo({ capabilities: ["kanban", "cron", "events"] });
  const { NextRequest } = await import("next/server");
  const { postProjectArchive } = await import("./project-routes");
  const { db, channels } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [channel] = await db.select().from(channels).where(eq(channels.id, f.channel.id));
  const res = await postProjectArchive(
    new NextRequest("http://localhost/archive", {
      method: "POST",
      headers: { "x-user-id": channel.ownerId },
      body: JSON.stringify({ status: "completed" }),
    }),
    f.channel.id,
    f.project.id,
  );
  assert.equal(res.status, 428);
  const body = await res.json();
  assert.equal(body.code, "event_cursor_handoff_required");
  assert.equal(JSON.stringify(body).includes("Cursor"), false);
});

test("일반 프로젝트 PATCH의 완료 상태도 같은 커서 인계를 거친다", async () => {
  const f = await fixture();
  const { updateChannelProject } = await import("./project-registry");
  const { resolveChannelBoard, listChannelBoards } = await import("./kanban-boards");
  const resolved = await resolveChannelBoard(f.channel.id);
  assert.ok(resolved.ok);
  const view = await updateChannelProject(f.channel.id, f.project.id, resolved.ownerClient, {
    status: "completed",
  });
  assert.equal(
    (await listChannelBoards(f.channel.id)).find((r) => r.isEventCarrier)?.id,
    f.target.id,
  );
  assert.equal(view.isEventCarrier, false);
});

for (const failAt of ["journal", "promote"] as const) {
  test(`${failAt} DB 쓰기 실패는 커서 내용을 노출하지 않고 재시도로 복구된다`, async () => {
    const f = await fixture();
    const { default: Database } = await import("better-sqlite3");
    const connection = new Database(sqlitePath);
    const trigger = "fail_handoff_" + failAt;
    const predicate =
      failAt === "journal"
        ? `NEW.id = '${f.source.id}' AND NEW.event_carrier_handoff_json IS NOT NULL`
        : `NEW.id = '${f.target.id}' AND NEW.is_event_carrier = 1`;
    connection.exec(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON channel_kanban_boards WHEN ${predicate} BEGIN SELECT RAISE(ABORT, 'injected DB failure'); END`,
    );
    const { archiveChannelProject, readProject } = await import("./project-registry");
    try {
      await assert.rejects(() => archiveChannelProject(f.channel.id, f.project.id, "completed"), {
        code: "event_carrier_handoff_pending",
        message: "event_carrier_handoff_pending",
      });
    } finally {
      connection.exec(`DROP TRIGGER ${trigger}`);
      connection.close();
    }
    await archiveChannelProject(f.channel.id, f.project.id, "completed");
    assert.equal((await readProject(f.channel.id, f.project.id)).status, "completed");
    const { listChannelBoards } = await import("./kanban-boards");
    const rows = await listChannelBoards(f.channel.id);
    assert.equal(rows.find((r) => r.isEventCarrier)?.id, f.target.id);
    assert.ok(rows.every((r) => r.eventCarrierHandoffJson === null));
  });
}
