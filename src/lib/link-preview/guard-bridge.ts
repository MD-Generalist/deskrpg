/**
 * `fetch.ts` 가 쓰는 기본 판정. 주소 검사(순수)와 이름 해석(I/O)을 한 함수로 묶는다 —
 * 테스트는 이 함수를 대신 넣을 수 있고(`isAllowedUrl`), 실서비스는 이것이 기본값이다.
 */
import { parsePreviewTarget, resolvesToPublicAddress } from "./guard";

export async function isAllowedPreviewUrlDefault(url: URL): Promise<boolean> {
  const parsed = parsePreviewTarget(url.toString());
  if (!parsed) return false;
  return resolvesToPublicAddress(parsed.hostname);
}
