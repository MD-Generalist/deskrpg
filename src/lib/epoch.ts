/** 플러그인 사건·아티팩트의 시각은 epoch 초다(플러그인 0.6.0+ 전 출처). 화면은 여기서만 ms 로 바꾼다. */
export function epochSecondsToMs(ts: number): number {
  return ts * 1000;
}
