import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { after, test } from "node:test";

import { startFakePluginServer, type FakePluginServer } from "./hermes/fake-plugin-server";
import { seedChannel, seedGateway, seedUser, setupThrowawaySqlite } from "@/test-setup/npc-seed";

setupThrowawaySqlite("event-carrier-concurrency");
const servers: FakePluginServer[] = [];
after(async () => Promise.all(servers.map((server) => server.close())));

async function fixture(boardCount = 2) {
  const server = await startFakePluginServer({
    ownerToken: "gateway-owner-key-1234567890",
    profileTokens: {},
  });
  servers.push(server);
  const user = await seedUser("concurrency");
  const gateway = await seedGateway(user.id, server.baseUrl);
  const channel = await seedChannel(user.id, "Concurrency");
  const { bindGatewayToChannel } = await import("./gateway-resources");
  await bindGatewayToChannel({
    channelId: channel.id,
    gatewayId: gateway.id,
    boundByUserId: user.id,
  });
  const { ensureChannelBoard, listChannelBoards } = await import("./kanban-boards");
  for (let index = 1; index < boardCount; index += 1) {
    await ensureChannelBoard(channel.id, undefined, `project-${index}`);
  }
  const boards = await listChannelBoards(channel.id);
  const { ensureProjectRow } = await import("./project-registry");
  const projects = await Promise.all(boards.map((board) => ensureProjectRow(board)));
  return { server, user, gateway, channel, boards, projects };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function tick() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("delayed poll saves its cursor before queued archive chooses the carrier", async () => {
  const f = await fixture();
  const { createDefaultPollDeps, pollChannelOnce } = await import("@/server/automation-poller");
  const { archiveChannelProject, readProject } = await import("./project-registry");
  const { listChannelBoards } = await import("./kanban-boards");
  const deps = createDefaultPollDeps({ emitChannel: () => {}, emitRoomMessage: () => {} });
  const saved = barrier();
  const entered = barrier();
  const originalSave = deps.saveRow;
  let held = false;
  deps.saveRow = async (id, patch) => {
    if (!held && id === f.boards[0].id && patch.eventCursor) {
      held = true;
      entered.release();
      await saved.promise;
    }
    return originalSave(id, patch);
  };
  const poll = pollChannelOnce(f.channel.id, deps);
  await entered.promise;
  const archive = archiveChannelProject(f.channel.id, f.projects[0].id, "completed");
  await tick();
  assert.equal((await readProject(f.channel.id, f.projects[0].id)).status, "planned");
  saved.release();
  const [pollResult, archiveResult] = await Promise.all([poll, archive]);
  assert.equal(pollResult.ok, true);
  assert.equal(archiveResult.carrierMovedTo, f.boards[1].boardSlug);
  const rows = await listChannelBoards(f.channel.id);
  assert.equal(rows.find((row) => row.isEventCarrier)?.id, f.boards[1].id);
  assert.ok(rows[0].eventCursor && rows[1].eventCursor);
});

test("simultaneous carrier and next-project archives serialize two handoffs", async () => {
  const f = await fixture(3);
  const { archiveChannelProject, readProject } = await import("./project-registry");
  const { listChannelBoards } = await import("./kanban-boards");
  const first = archiveChannelProject(f.channel.id, f.projects[0].id, "completed");
  const second = archiveChannelProject(f.channel.id, f.projects[1].id, "cancelled");
  const results = await Promise.all([first, second]);
  assert.deepEqual(
    results.map((result) => result.carrierMovedTo),
    [f.boards[1].boardSlug, f.boards[2].boardSlug],
  );
  const rows = await listChannelBoards(f.channel.id);
  assert.deepEqual(
    rows.filter((row) => row.isEventCarrier).map((row) => row.id),
    [f.boards[2].id],
  );
  assert.equal((await readProject(f.channel.id, f.projects[0].id)).status, "completed");
  assert.equal((await readProject(f.channel.id, f.projects[1].id)).status, "cancelled");
  assert.ok(rows.every((row) => row.eventCarrierHandoffJson === null));
});

test("project creation re-resolves the gateway after a queued replacement", async () => {
  const f = await fixture();
  const replacementServer = await startFakePluginServer({
    ownerToken: "gateway-owner-key-1234567890",
    profileTokens: {},
  });
  servers.push(replacementServer);
  const replacement = await seedGateway(f.user.id, replacementServer.baseUrl);
  const { withChannelAutomationLock } = await import("./channel-automation-lock");
  const { bindGatewayToChannel } = await import("./gateway-resources");
  const { createChannelProject } = await import("./project-registry");
  const { createOwnerPluginClient } = await import("./hermes/plugin-client");
  const { listChannelBoards } = await import("./kanban-boards");
  const held = barrier();
  const entered = barrier();
  const lease = withChannelAutomationLock(f.channel.id, async () => {
    entered.release();
    await held.promise;
  });
  await entered.promise;
  const bind = bindGatewayToChannel({
    channelId: f.channel.id,
    gatewayId: replacement.id,
    boundByUserId: f.user.id,
  });
  const staleClient = createOwnerPluginClient({
    baseUrl: f.server.baseUrl,
    ownerToken: "gateway-owner-key-1234567890",
  });
  const create = createChannelProject(f.channel.id, staleClient, {
    name: "New project",
    createdByUserId: f.user.id,
  });
  held.release();
  await lease;
  await bind;
  const created = await create;
  const board = (await listChannelBoards(f.channel.id)).find(
    (row) => row.boardSlug === created.project.boardSlug,
  );
  assert.equal(board?.gatewayId, replacement.id);
  assert.ok(
    replacementServer
      .requests()
      .some(
        (request) =>
          request.method === "PATCH" &&
          request.path === `/deskrpg/kanban/boards/${board?.boardSlug}`,
      ),
  );
  assert.ok(
    !f.server
      .requests()
      .some(
        (request) =>
          request.method === "PATCH" &&
          request.path === `/deskrpg/kanban/boards/${board?.boardSlug}`,
      ),
  );
});

for (const action of ["unbind", "bind"] as const) {
  test(`gateway ${action} waits for an active channel lease before changing binding`, async () => {
    const f = await fixture();
    const { withChannelAutomationLock } = await import("./channel-automation-lock");
    const { archiveChannelProject } = await import("./project-registry");
    const { bindGatewayToChannel, getChannelGatewayBinding, unbindGatewayFromChannel } =
      await import("./gateway-resources");
    const held = barrier();
    const entered = barrier();
    const lease = withChannelAutomationLock(f.channel.id, async () => {
      entered.release();
      await held.promise;
    });
    await entered.promise;
    const archive = archiveChannelProject(f.channel.id, f.projects[0].id, "completed");
    const replacement = action === "bind" ? await seedGateway(f.user.id, f.server.baseUrl) : null;
    const change =
      action === "bind"
        ? bindGatewayToChannel({
            channelId: f.channel.id,
            gatewayId: replacement!.id,
            boundByUserId: f.user.id,
          })
        : unbindGatewayFromChannel(f.channel.id);
    await tick();
    assert.equal((await getChannelGatewayBinding(f.channel.id))?.binding.gatewayId, f.gateway.id);
    held.release();
    await lease;
    await archive;
    await change;
    assert.equal(
      (await getChannelGatewayBinding(f.channel.id))?.binding.gatewayId ?? null,
      replacement?.id ?? null,
    );
  });
}

test("independently bundled lock modules share the same process-global queue", async () => {
  const { build } = await import("esbuild");
  const directory = await mkdtemp(join(tmpdir(), "deskrpg-lock-bundles-"));
  try {
    const entry = join(process.cwd(), "src/lib/channel-automation-lock.ts");
    const firstPath = join(directory, "next.cjs");
    const secondPath = join(directory, "socket.cjs");
    await Promise.all(
      [firstPath, secondPath].map((outfile) =>
        build({ entryPoints: [entry], outfile, bundle: true, platform: "node", format: "cjs" }),
      ),
    );
    const require = createRequire(import.meta.url);
    const first = require(firstPath) as typeof import("./channel-automation-lock");
    const second = require(secondPath) as typeof import("./channel-automation-lock");
    const held = barrier();
    const order: string[] = [];
    const pending = first.withChannelAutomationLock("bundle-channel", async () => {
      order.push("next");
      await held.promise;
    });
    await tick();
    const queued = second.withChannelAutomationLock("bundle-channel", async () => {
      order.push("socket");
    });
    await tick();
    assert.deepEqual(order, ["next"]);
    held.release();
    await Promise.all([pending, queued]);
    assert.deepEqual(order, ["next", "socket"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
