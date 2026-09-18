#!/bin/sh
set -e

# PostgreSQL 설치는 방언을 환경에 명시한다. 기동 시 런타임 홈 부트스트랩
# (src/lib/runtime-env-bootstrap.js → ensureDeskRpgHome)이 홈의 .env.local 에 DB_TYPE=sqlite 를
# 적고, 환경에 DB_TYPE 이 없으면 그 값을 올린다. 그러면 마이그레이션은 PostgreSQL 에 돌고 앱은
# 컨테이너 안(볼륨이 아닌) SQLite 에 기록해 재생성 때 데이터가 사라진다(2026-09-18 운영 실측).
# 사용자가 DB_TYPE 을 지정한 경우에는 건드리지 않는다.
if [ -z "${DB_TYPE:-}" ] && [ -n "${DATABASE_URL:-}" ]; then
  export DB_TYPE=postgresql
fi

# Auto-migrate: run Drizzle PostgreSQL migrations before starting the server
if [ -d "/app/drizzle" ] && [ "$DB_TYPE" != "sqlite" ]; then
  node /app/migrate.js
fi

# 자리표시자 시크릿은 "값이 없는 것" 과 같이 다룬다.
#
# Hostinger 의 Docker Manager 는 레포 `.env.example` 을 환경변수 칸에 그대로 채우므로,
# 손대지 않고 배포하면 JWT_SECRET 에 안내 문구가 들어온 채로 컨테이너가 뜬다. 환경변수는
# 파일보다 우선하기 때문에 `ensureDeskRpgHome` 이 볼륨에 만들어 둔 진짜 키를 가려 버리고,
# startup-check 는 자리표시자를 거부해 컨테이너가 재시작 루프에 빠진다(2026-09-16 실측).
#
# 여기서 unset 하면 우선순위가 의도대로 선다:
#   1. 사용자가 직접 넣은 값        → 그대로 쓴다 (자리표시자가 아니므로 남는다)
#   2. 볼륨에 저장된 이전 생성값     → 재시작해도 같은 키
#   3. 둘 다 없으면                 → 새로 만들어 볼륨에 저장
#
# 판정은 `isPlaceholderSecret` 하나에 맡긴다. 셸에서 패턴을 다시 적으면 두 곳이 갈라진다.
if [ -n "${JWT_SECRET+x}" ]; then
  if node -e 'const {isPlaceholderSecret}=require("/app/src/lib/runtime-paths.js");process.exit(isPlaceholderSecret(process.env.JWT_SECRET||"")?0:1)'; then
    echo "[entrypoint] JWT_SECRET 이 자리표시자라 무시합니다 — 런타임이 키를 만들어 데이터 볼륨에 보관합니다."
    unset JWT_SECRET
  fi
fi

exec node --import tsx server.js
