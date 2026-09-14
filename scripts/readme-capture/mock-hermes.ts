import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP } from "node:net";

const CAPTURE_TOKENS = new Set([
  "readme-capture-gateway-token",
  "readme-capture-sophie-token",
  "readme-capture-noah-token",
]);

export const CHAT_SCRIPT = ["좋은 ", "아침이에요. ", "오늘 일정부터 함께 확인할게요."];

const MEETING_LINES = {
  sophie: "SPEAK: 오전에는 릴리스 점검부터 진행하겠습니다.",
  noah: "SPEAK: 저는 사용자 피드백을 정리해 공유하겠습니다.",
} as const;

type MeetingProfile = keyof typeof MEETING_LINES;

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}

function isMeetingProfile(profile: string): profile is MeetingProfile {
  return Object.hasOwn(MEETING_LINES, profile);
}

function isAuthorized(request: IncomingMessage): boolean {
  const authorization = request.headers.authorization;
  return (
    typeof authorization === "string" &&
    authorization.startsWith("Bearer ") &&
    CAPTURE_TOKENS.has(authorization.slice("Bearer ".length))
  );
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function writeSse(
  response: ServerResponse,
  eventName: "assistant" | "message",
  chunks: string[],
) {
  response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const [index, delta] of chunks.entries()) {
    response.write(
      `event: ${eventName}.delta\ndata: ${JSON.stringify({ delta, seq: index + 1 })}\n\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  response.write(
    `event: ${eventName}.completed\ndata: ${JSON.stringify({ content: chunks.join("") })}\n\n`,
  );
  response.end(`event: run.completed\ndata: {}\n\n`);
}

export async function startMockHermes({ host, port }: { host: string; port: number }): Promise<{
  baseUrl: string;
  close(): Promise<void>;
}> {
  if (!isLoopbackHost(host)) throw new Error(`Mock Hermes must listen on a loopback host: ${host}`);

  let sessionSequence = 0;
  let runSequence = 0;
  const runs = new Map<string, { profile: MeetingProfile; room: boolean }>();
  const server = createServer((request, response) => {
    const handle = async () => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("ok");
        return;
      }
      if (!isAuthorized(request)) {
        writeJson(response, 401, { error: "unauthorized" });
        return;
      }

      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);
      const match = /^\/p\/([^/]+)(\/.*)$/.exec(url.pathname);
      if (!match) {
        writeJson(response, 404, { error: "not_found" });
        return;
      }

      const [, encodedProfile, path] = match;
      const profile = decodeURIComponent(encodedProfile);
      if (!isMeetingProfile(profile)) {
        writeJson(response, 404, { error: "unknown_profile" });
        return;
      }

      if (request.method === "GET" && path === "/v1/capabilities") {
        writeJson(response, 200, {
          features: { sessions: true, runs: true },
          endpoints: {
            sessions: { method: "POST", path: "/api/sessions" },
            sessionChat: { method: "POST", path: "/api/sessions/:id/chat/stream" },
            runs: { method: "POST", path: "/v1/runs" },
            runEvents: { method: "GET", path: "/v1/runs/:id/events" },
          },
        });
        return;
      }

      if (request.method === "POST" && path === "/api/sessions") {
        const id = `session-${++sessionSequence}`;
        writeJson(response, 200, {
          object: "hermes.session",
          session: { id, source: "api_server", message_count: 0 },
        });
        return;
      }

      const chat = /^\/api\/sessions\/([^/]+)\/chat\/stream$/.exec(path);
      if (request.method === "POST" && chat) {
        await writeSse(response, "assistant", CHAT_SCRIPT);
        return;
      }

      if (request.method === "POST" && path === "/v1/runs") {
        const runId = `run-${++runSequence}`;
        runs.set(runId, {
          profile,
          room: String(request.headers["x-hermes-session-key"] ?? "").includes("-room-"),
        });
        writeJson(response, 202, { run_id: runId });
        return;
      }

      const runEvents = /^\/v1\/runs\/([^/]+)\/events$/.exec(path);
      if (request.method === "GET" && runEvents) {
        const runId = decodeURIComponent(runEvents[1]);
        if (runs.get(runId)?.profile !== profile) {
          writeJson(response, 404, { error: "not_found" });
          return;
        }
        await writeSse(
          response,
          "message",
          runs.get(runId)!.room ? CHAT_SCRIPT : [MEETING_LINES[profile]],
        );
        return;
      }

      writeJson(response, 404, { error: "not_found" });
    };

    void handle().catch(() => writeJson(response, 500, { error: "mock_error" }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Mock Hermes did not expose a TCP address");
  const originHost = host.includes(":") ? `[${host}]` : host;

  return {
    baseUrl: `http://${originHost}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
