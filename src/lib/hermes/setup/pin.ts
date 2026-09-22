/**
 * 마법사가 설치하는 `deskrpg-hermes-plugin` 의 고정 좌표.
 *
 * 값 자체는 호스트에서 도는 Python(`host-helper.ts` 의 `PIN`/`PLUGIN_VERSION`)이 쓰고,
 * 화면은 사람에게 보여 주기만 한다. 예전에는 화면이 앞 12자를 손으로 베껴 두어
 * 플러그인을 올릴 때마다 한쪽만 고치면 화면이 거짓말을 했다 — 이제 두 곳이 같은 상수를
 * 읽고, `pin.test.ts` 가 Python 쪽 리터럴과 대조해 어긋남을 막는다.
 */
export const PLUGIN_PIN = "cf794d23b8057f04a60dfb93eaf8b92b8530cca5";
export const PLUGIN_VERSION = "0.13.1";
/** 화면에 쓰는 짧은 표기. 커밋 전체를 보여 줄 자리가 없다. */
export const PLUGIN_PIN_SHORT = PLUGIN_PIN.slice(0, 12);
