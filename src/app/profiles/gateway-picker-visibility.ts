/** 게이트웨이가 하나뿐인 사용자(대부분)에게 고를 것이 없는 선택기를 보이지 않는다. */
export function showGatewayPicker(gatewayCount: number): boolean {
  return gatewayCount >= 2;
}
