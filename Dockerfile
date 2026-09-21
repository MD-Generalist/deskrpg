# Dockerfile
# Match the release verifier's Node ABI so native SQLite/canvas prebuilds are available.
FROM node:22-bookworm-slim AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_COMING_SOON=false
ARG NEXT_PUBLIC_REGISTRATION_DISABLED=false
# CLI adapter tools (optional)
ARG ENABLE_CLAUDE=false
ARG ENABLE_CODEX=false
ARG ENABLE_GEMINI=false
ARG ENABLE_OPENCODE=false
ENV NEXT_PUBLIC_COMING_SOON=$NEXT_PUBLIC_COMING_SOON
ENV NEXT_PUBLIC_REGISTRATION_DISABLED=$NEXT_PUBLIC_REGISTRATION_DISABLED
RUN npm run build

FROM base AS runner
LABEL org.opencontainers.image.source="https://github.com/dandacompany/deskrpg"
WORKDIR /app
ENV NODE_ENV=production
# CLI adapter tools (optional; re-declared for runner stage)
ARG ENABLE_CLAUDE=false
ARG ENABLE_CODEX=false
ARG ENABLE_GEMINI=false
ARG ENABLE_OPENCODE=false
# 연결 마법사의 SSH 연결(ssh·ssh-keygen·ssh-keyscan). 대상 서버에서 도는 python3 는 넣지 않는다.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssh-client \
  && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Custom server with Socket.io (replaces default standalone server.js)
COPY --from=builder /app/server.js ./server.js

# CommonJS modules required by server.js (not traced by Next.js standalone)
# `src/lib` 는 **디렉터리째** 복사한다. 파일마다 COPY 하면 줄마다 레이어가 하나씩 생겨, 런타임 의존이
# 늘 때마다 이미지가 overlay2 의 레이어 한도에 다가간다 — 2026.921.2 는 126 레이어가 되어 Linux 에서
# `docker pull` 이 `max depth exceeded` 로 실패했다. 새 의존을 더할 때 이 파일을 고칠 필요도 없어진다.
COPY --from=builder /app/src/lib ./src/lib

# 대화 런타임과 소켓 서버는 **디렉토리째** 복사한다.
#
# 예전에는 파일을 한 줄씩 나열했는데, 그 목록은 파일이 추가·개명될 때마다 썩었다.
# 실제로 삭제된 meeting-broker.js·openclaw-gateway.js 를 계속 COPY 해 빌드가 깨졌고,
# 2단계에서 늘어난 conversation 모듈 여덟 개는 아예 빠져 있었다 — server.js 가 런타임에
# socket-handlers.ts 를 import 하므로 그대로 두면 컨테이너가 기동에서 죽는다.
#
# 목록을 손으로 맞추는 대신 경계를 통째로 옮긴다. 새 형제 파일이 생겨도 따라온다.
COPY --from=builder /app/src/server ./src/server
# Pure shared map geometry and navigation used by channel motion coordination.
COPY --from=builder /app/src/game/navigation.ts ./src/game/navigation.ts
# Shared catalog/layout/seat modules evolve together; retain their runtime boundary.
COPY --from=builder /app/src/game/three ./src/game/three
COPY --from=builder /app/src/game/ambient-zones.ts ./src/game/ambient-zones.ts
COPY --from=builder /app/src/game/meeting-map-normalization.ts ./src/game/meeting-map-normalization.ts
COPY --from=builder /app/src/game/meeting-space.ts ./src/game/meeting-space.ts

# DB 경계는 통째로 옮긴다. 파일 목록으로 두면 `require("./sqlite-...js")` 처럼
# 정적 추적에 안 걸리는 진입점이 생길 때마다 조용히 빠진다 — 실제로 이관 모듈
# 둘(sqlite-npc-profile-ownership.js, sqlite-openclaw-retirement.js)이 COPY 줄
# 없이 Next 의 standalone 추적에 얹혀 살아 있었다.
COPY --from=builder /app/src/db ./src/db
# NPC 의 이름·외형은 Hermes 프로필이 정본이다 — 소켓 서버의 NPC 로더가 이 투영을 거친다.
# npc:set-active 소켓 핸들러가 출근/퇴근 토글에 쓴다.
# NOTE: src/lib/runtime-paths.ts (ESM) is distinct from src/lib/runtime-paths.js
# (CJS, copied above for openclaw-gateway.js's require()). db/index.ts imports the
# extensionless "../lib/runtime-paths", which TypeScript resolves to the .ts file.
# gateway-resources 가 바인딩 뒤 보드 확보(T4)를 위해 끌어온다 — 빠지면 소켓 서버가 기동에서 죽는다.
# 폴러(T5)가 REST 라우트에 자기를 꽂는 globalThis 레지스트리 — 빠지면 소켓 서버가 기동에서 죽는다.
# 자동화 사건 싱크(T5)가 크론 결과의 출처를 대조하려고 끌어온다.
# 회의 규약 폴백(getDefaultMeetingProtocol)이 끌어오는 프리셋·로케일 트리.
# Whole-directory copies (not per-file): this project has missed individual files in
# these two directories five times (most recently local-discovery-gate.ts and
# profile-name.ts, neither of which had its own COPY line before this fix).

# .dockerignore does NOT apply to `COPY --from=<stage>` — it filters the build context
# sent to the daemon, not files already inside a stage. Verified by inspecting a built
# image: all seven *.test.ts under src/lib/hermes shipped despite the .dockerignore
# entries. Strip them here, after the directory copies, where it actually takes effect.
RUN find ./src -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.test.js' | xargs -r rm -f

COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Drizzle ORM + PostgreSQL driver (used by server.js, task-manager.js, server-db.js)
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/pg ./node_modules/pg
COPY --from=builder /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=builder /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=builder /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder /app/node_modules/split2 ./node_modules/split2
COPY --from=builder /app/node_modules/xtend ./node_modules/xtend

# Socket.io runtime dependencies (not traced by Next.js standalone)
COPY --from=builder /app/node_modules/socket.io ./node_modules/socket.io
COPY --from=builder /app/node_modules/socket.io-adapter ./node_modules/socket.io-adapter
COPY --from=builder /app/node_modules/socket.io-parser ./node_modules/socket.io-parser
COPY --from=builder /app/node_modules/engine.io ./node_modules/engine.io
COPY --from=builder /app/node_modules/engine.io-parser ./node_modules/engine.io-parser
COPY --from=builder /app/node_modules/ws ./node_modules/ws
COPY --from=builder /app/node_modules/@socket.io ./node_modules/@socket.io
COPY --from=builder /app/node_modules/cors ./node_modules/cors
COPY --from=builder /app/node_modules/vary ./node_modules/vary
COPY --from=builder /app/node_modules/object-assign ./node_modules/object-assign
COPY --from=builder /app/node_modules/debug ./node_modules/debug
COPY --from=builder /app/node_modules/ms ./node_modules/ms
COPY --from=builder /app/node_modules/base64id ./node_modules/base64id
COPY --from=builder /app/node_modules/cookie ./node_modules/cookie
COPY --from=builder /app/node_modules/accepts ./node_modules/accepts
COPY --from=builder /app/node_modules/negotiator ./node_modules/negotiator
COPY --from=builder /app/node_modules/mime-types ./node_modules/mime-types
COPY --from=builder /app/node_modules/mime-db ./node_modules/mime-db
COPY --from=builder /app/node_modules/jose ./node_modules/jose
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=builder /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=builder /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps

# Migration runner + SQL files
COPY --from=builder /app/migrate.js ./migrate.js
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Install CLI adapters based on build args
RUN if [ "$ENABLE_CLAUDE" = "true" ]; then npm install -g @anthropic-ai/claude-code && echo 'Claude Code installed'; fi
RUN if [ "$ENABLE_CODEX" = "true" ]; then npm install -g @openai/codex && echo 'Codex CLI installed'; fi
RUN if [ "$ENABLE_GEMINI" = "true" ]; then echo 'TODO: gemini CLI install command'; fi
RUN if [ "$ENABLE_OPENCODE" = "true" ]; then npm install -g opencode && echo 'OpenCode installed'; fi

# Data directories for adapter auth and workspaces
RUN mkdir -p /var/deskrpg/users /var/deskrpg/workspaces && chown -R nextjs:nodejs /var/deskrpg
VOLUME /var/deskrpg/users
VOLUME /var/deskrpg/workspaces
ENV DESKRPG_HOME=/app/data
ENV DESKRPG_DATA_DIR=/var/deskrpg
ENV INTERNAL_HOSTNAME="0.0.0.0"

USER nextjs
EXPOSE 3000 3001
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["./docker-entrypoint.sh"]
