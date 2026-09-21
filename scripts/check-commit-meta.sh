#!/usr/bin/env bash
# 커밋 메시지에 개발 메타가 들어가지 않게 막는다. 이 레포는 공개다.
#
# 공개 트리 검사(check-public-tree.sh)는 파일만 본다. 그런데 커밋 메시지도 공개되고,
# 한번 올라간 메시지는 히스토리를 다시 쓰지 않는 한 회수할 수 없다 — 실제로 세션
# 트레일러가 든 커밋이 공개 master 에 쌓였다. 사람의 기억 대신 이 검사가 막는다.
#
# 입력: 표준 입력으로 메시지 하나 이상. git 이 붙이는 # 주석 줄은 보지 않는다.
# 쓰는 곳: .githooks/commit-msg(커밋마다), .githooks/pre-push(푸시할 커밋 전부 —
#          rebase·cherry-pick 은 commit-msg 를 다시 돌리지 않으므로 여기가 마지막 관문).
set -euo pipefail

# 각 줄: 설명<TAB>ERE
patterns=$(cat <<'P'
세션 트레일러	Claude-Session:|session_01[A-Za-z0-9]
비공개 보드 식별자	(^|[^A-Za-z0-9])(PVT|PVTI|PVTSSF|PVTF|DI)_[A-Za-z0-9]{6,}
비공개 문서 경로(docs/ 는 공개 트리에 없다)	(^|[^A-Za-z0-9_./-])docs/
하네스 작업 폴더	\.superpowers/|\.dryforge/
P
)

body=$(grep -v '^#' || true)
found=0
while IFS=$'\t' read -r label regex; do
  [ -z "$label" ] && continue
  hits=$(printf '%s\n' "$body" | grep -nE -- "$regex" || true)
  if [ -n "$hits" ]; then
    found=1
    printf '커밋 메시지에 개발 메타가 있습니다 — %s:\n%s\n' "$label" "$hits" >&2
  fi
done <<< "$patterns"

if [ "$found" -ne 0 ]; then
  cat >&2 <<'MSG'

이 레포는 공개라 커밋 메시지도 그대로 공개됩니다. 해당 줄을 지우세요.
카드와의 연결은 반대 방향으로 합니다 — 카드 본문에 커밋 SHA 를 적습니다.
MSG
  exit 1
fi
