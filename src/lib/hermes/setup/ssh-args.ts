/**
 * SSH 인자 조립. 순수 함수라 맥에서 win32 경로를 그대로 테스트한다 — 상류 Hermes Desktop 의
 * `ssh-connection.ts` 도 같은 이유로 "Command construction (pure)" 를 따로 뽑아 두었다.
 *
 * Windows OpenSSH 는 ControlMaster mux 소켓을 구현한 적이 없다. 그래서 win32 에서는 제어 소켓을
 * 쓰지 않고 터널마다 `ssh -N -L` 자식 하나를 띄운다. 인증 핸드셰이크 재사용을 잃지만 우리는
 * 게이트웨이당 터널 하나라 영향이 작다.
 */
import { isWindows, nullDevicePath } from "./platform";

export function usesControlMaster(platform: string): boolean {
  return !isWindows(platform);
}

/** 포워드 명세. 로컬은 언제나 127.0.0.1 이다 — 터널이 바깥에 열리면 안 된다. */
function forwardSpec(localPort: number, remotePort: number): string {
  return `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`;
}

export function tunnelArgs(input: {
  platform: string;
  routeArgs: string[];
  routeOptions: string[];
  dest: string;
  socket: string;
  localPort: number;
  remotePort: number;
}): string[] {
  const common = ["-o", "ExitOnForwardFailure=yes", "-N", "-T", "--", input.dest];
  if (!usesControlMaster(input.platform)) {
    // 제어 소켓이 없다. 포워드를 이 자식이 직접 연다.
    return [
      ...input.routeArgs,
      ...input.routeOptions,
      "-L",
      forwardSpec(input.localPort, input.remotePort),
      ...common,
    ];
  }
  return [
    ...input.routeArgs,
    // 현행과 같다 — 마지막 옵션 쌍 두 개를 떼고 마스터 옵션을 붙인다.
    ...input.routeOptions.slice(0, -4),
    "-M",
    "-S",
    input.socket,
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ClearAllForwardings=yes",
    "-N",
    "-T",
    "--",
    input.dest,
  ];
}

export function forwardArgs(input: {
  platform: string;
  socket: string;
  hostId: string;
  localPort: number;
  remotePort: number;
}): string[] {
  if (!usesControlMaster(input.platform)) throw new Error("setup_invalid_request");
  return [
    "-F",
    nullDevicePath(input.platform),
    "-S",
    input.socket,
    "-O",
    "forward",
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-L",
    forwardSpec(input.localPort, input.remotePort),
    "--",
    input.hostId,
  ];
}
