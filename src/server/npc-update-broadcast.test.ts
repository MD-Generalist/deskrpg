import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";
import { broadcastNpcUpdate } from "./npc-update-broadcast";

for (const delayed of [
  "select",
  "invalidate",
  "first revision read",
  "final revision read",
] as const) {
  for (const change of ["refresh", "revision", "identity"] as const) {
    test(`late NPC broadcast after ${delayed} cannot cross ${change} boundary`, async () => {
      const http = createServer();
      const io = new Server(http, { transports: ["websocket"] });
      let revisionReads = 0;
      let generation = 0;
      let revision = "v2";
      let player = { mapId: "channel" };
      let release!: () => void;
      let started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const delayedWork = async () => {
        started();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      };
      let completed!: () => void;
      const completion = new Promise<void>((resolve) => {
        completed = resolve;
      });
      io.on("connection", (socket) => {
        socket.join("channel");
        socket.on("npc:broadcast-update", (data: unknown) => {
          void broadcastNpcUpdate(socket, data, {
            getPlayer: () => player,
            admittedRevision: () => "v2",
            generation: () => generation,
            isPaused: () => false,
            requiresRefresh: () => false,
            readRevision: async () => {
              revisionReads++;
              if (
                (delayed === "first revision read" && revisionReads === 1) ||
                (delayed === "final revision read" && revisionReads === 2)
              )
                await delayedWork();
              return revision;
            },
            selectNpc: async () => {
              if (delayed === "select") await delayedWork();
              return {
                id: "npc",
                channelId: "channel",
                name: "NPC",
                positionX: 2,
                positionY: 2,
                direction: "down",
                appearance: {},
                active: true,
              };
            },
            invalidate: async () => {
              if (delayed === "invalidate") await delayedWork();
            },
            invalidateRooms: () => {},
          }).finally(completed);
        });
      });
      http.listen(0, "127.0.0.1");
      await once(http, "listening");
      const address = http.address();
      assert.ok(address && typeof address !== "string");
      const sender = connect(`http://127.0.0.1:${address.port}`, { transports: ["websocket"] });
      const observer = connect(`http://127.0.0.1:${address.port}`, {
        transports: ["websocket"],
        forceNew: true,
      });
      try {
        await Promise.all(
          [sender, observer].map(
            (client) => new Promise<void>((resolve) => client.once("connect", resolve)),
          ),
        );
        const updates: unknown[] = [];
        observer.on("npc:updated", (data) => updates.push(data));
        sender.emit("npc:broadcast-update", { npcId: "npc" });
        await waiting;
        if (change === "refresh") generation++;
        if (change === "revision") revision = "v3";
        if (change === "identity") player = { mapId: "channel" };
        release();
        await completion;
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(updates, [], "a delayed v2 home must never replace fresh client geometry");
      } finally {
        sender.disconnect();
        observer.disconnect();
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }
    });
  }
}
