# 무역상사 v3 제작·검증 기록

사용자 제공 무역회사.png를 기준으로 44×30 U자형 사무실을 구성했다. 중앙 전면 8×11셀은 실제 바닥과 통행 영역에서 제외한다. 4인 업무석6개,12인 대회의실, 소회의실2개, 개별 집무실3개, 상품 전시실과 응접석을 구성했다. 전체55석은 실제 접근 앵커 경로로 검증한다.

## 재사용 모듈

- office-layout-modules: 방/문,4인 업무석,응접 가구 조립, 바닥/충돌 마스크.
- office-footprint: 셀에서 U/L 외곽 추출. 대각선만 맞닿는 셀과 닫힌 중정은 명시적으로 거부한다. 중정 지원을 주장하지 않는다.
- office-perimeter: 임의 직교 프레임 구간 렌더링. 실내 프레임은 외곽 축까지 연장한다.
- 기존 GLB exporter를 buildAuthoredAssets로 공유. 무역7종을 카탈로그로 등록하고 텍스처·bounds·파일예산을 검사한다.
- `node scripts/assets/build-office-thumbnails.cjs trading`: 변경된 맵만 캡처·썸네일 갱신. 전체 맵 반복 캡처를 피한다.

## 검증·한계

실제 렌더러 캡처: /tmp/deskrpg-trading-v3-final/tech-overview.png.55석,14개 에셋 identity,3,307,972byte,56draw,751,828triangle,로딩 오류0. 정적0명 수동 프레임이므로 실제 다중 사용자FPS를 검증한 수치가 아니다. 이미지의 정확한 사진 재현이 아닌 게임용 미니어처 해석이다.

전체 원본 trading v2 스냅샷만 기존 backup/CAS 경로로 갱신한다. 사용자 편집 맵은 그대로 남긴다. 이동/좌석 예약/AI 컨텍스트 로직은 변경하지 않는다.

## 세계지도 출처

Natural Earth 기반 world-atlas2.0.2 land-110m.json에서 벽화를 생성했다. 원본과 ISC 라이선스는 scripts/assets/sources에 보존한다. https://github.com/topojson/world-atlas 및 https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json
