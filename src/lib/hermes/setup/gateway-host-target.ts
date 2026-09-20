/**
 * 이미 등록된 게이트웨이의 **주소만 보고** 그 호스트를 우리가 다룰 수 있는지 가른다.
 *
 * 갱신은 호스트에서 명령을 돌려야 하는 동작이라, 어느 호스트인지부터 정해야 한다. 우리가
 * 아는 것은 게이트웨이 레코드의 `baseUrl` 뿐이고, 거기서 갈리는 것은 셋이다.
 *
 *   - 루프백     — DeskRPG 가 도는 그 호스트다. 로컬 실행기로 다룬다.
 *   - ssh 등록   — `registerSshTransport` 가 만든 주소. 호스트 id 는 레지스트리에 있다.
 *   - 그 밖      — 우리가 명령을 돌릴 수 없는 곳이다(예: 컨테이너에서 본
 *                  `host.docker.internal`, 남이 운영하는 원격 Hermes).
 *
 * 순수 함수다 — 파일·네트워크를 보지 않는다. ssh 의 호스트 id 를 실제로 꺼내는 일은
 * 레지스트리를 읽어야 하므로 `transport.ts` 가 한다.
 */

/** `registerSshTransport` 가 쓰는 가짜 도메인. transport.ts 의 SUFFIX 와 같아야 한다. */
const SSH_SUFFIX = ".deskrpg-ssh.invalid";

export type GatewayHostKind =
  { mode: "local"; port: number } | { mode: "ssh" } | { mode: "unsupported" };

function isLoopbackHostname(hostname: string): boolean {
  const host =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

export function classifyGatewayHost(baseUrl: string): GatewayHostKind {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { mode: "unsupported" };
  }
  if (url.hostname.endsWith(SSH_SUFFIX)) return { mode: "ssh" };
  if (url.protocol === "http:" && isLoopbackHostname(url.hostname) && url.port) {
    const port = Number(url.port);
    if (Number.isInteger(port) && port > 0 && port <= 65535) return { mode: "local", port };
  }
  return { mode: "unsupported" };
}
