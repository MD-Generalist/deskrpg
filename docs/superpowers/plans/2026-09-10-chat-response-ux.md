# Chat Response UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Visible server receipt, processing state and live answers for map rooms and NPC DMs.
**Architecture:** Shared cumulative ChatResponse events connect server-owned request lifecycles to a client reducer and reusable reaction/status UI. Existing message DB remains authoritative.
**Tech Stack:** TypeScript, React, Socket.IO, node:test.
**Spec:** docs/superpowers/specs/2026-09-10-chat-response-ux-design.md

## Global Constraints
- Work only in .claude/worktrees/feat/chat-response-ux; never start or restart the master dev server.
- Receipt emoji is 👌. Translate visible labels in all four existing locales.
- No internal reasoning/tool text in answer content. No new dependencies or DB migration.
- Bound transient state and queue sizes; distinguish admission from active generation.
- IDs correlate source messages, individual requests and final persisted messages.

### Task 1: Request execution and server events (controller)
Files: src/lib/chat-response.ts, src/lib/conversation/open-chat-runtime.ts and tests, src/server/room-runtime.ts and tests, src/server/room-socket.ts and tests, src/server/socket-handlers.ts, new src/server/chat-response-tracker.ts and tests.
Interfaces: ChatResponse shared contract from spec; room socket sends saved source message ID to runtime; runtime adds request context and admission callback; server tracker maintains cumulative response snapshots and emits room/DM events.
- [x] Write regression tests for FIFO human calls preserving caller/context, parallel NPCs, exceptions, disposal and pre-completion chunks.
- [x] Run targeted tests to observe missing behavior.
- [x] Implement request identity, bounded per-NPC/session sequencing and lifecycle broadcasts. Keep automatic mention quota semantics; wait for persistence before final event.
- [x] Run runtime and socket tests; inspect compatibility of legacy callback consumers.

### Task 2: Client response state and UI (implementer)
Files: new src/app/game/chat-response-state.ts and tests; src/app/game/GamePageClient.tsx; src/components/ChatPanel.tsx; src/components/NpcDialog.tsx type; src/components/chat/ response UI and tests; src/lib/i18n locale files.
Interfaces: src/lib/chat-response.ts exports ChatResponse and ChatResponseStatus. room:response-state {roomId,response}, room:response-snapshot {roomId,responses}, npc:response-state {response}, npc:response-snapshot {npcId,responses}. Every response has requestId, sourceMessageId, npcId, npcName, status, content, updatedAt, optional messageId/error. NPC legacy response payload gains optional responseRequestId; ignore those events on upgraded UI since response-state owns tracked requests. DM outgoing sourceMessageId is a client UUID and is attached to its NpcChatMessage as id. Server-created requestId differs from sourceMessageId. Final DM records carry content; final room records carry persisted messageId. Snapshots replace that room/NPC scope so stale animation clears.
- [x] Write behavior tests first: interleaved NPC requests never overwrite each other; cumulative content replaces; final room history replaces stream by messageId; snapshots restore active state, disconnected scopes stop animation; duplicate snapshots/messages do not duplicate answers.
- [x] Implement pure reducer/helpers and reusable receipt/status/stream rendering. Receipts show accepted NPC names under source messages, even after completion. Terminal error shown without endless spinner. All active records visible; completed room records only rendered as fallback if final DB message not present. DM tracked replies use requestId, not last-message heuristic. Keep legacy events functional when responseRequestId absent.
- [x] Wire socket subscriptions and cleanup. Retain scope while switching views; clear live transient state on disconnect then restore via authorized snapshots. Do not copy state from another NPC/room. Permit sending while another tracked response runs; retain connection/file validation. Do not reset shared stream buffer for tracked requests.
- [x] Add translations and DOM tests for 👌, names, statuses and two simultaneous streams. Run tests, scoped lint and tsc; report baseline errors separately.

### Task 3: Integrated review and verification (controller + reviewer)
- [x] Review entire diff for privacy boundaries, async races, failed persistence, cleanup, deduplication and localization.
- [x] Run npm test, npm run typecheck and scoped eslint/prettier checks. Fix introduced failures only.
- [x] Run isolated browser verification if local infrastructure allows; explicitly report any limitation.
- [x] Record outcome, retain worktree for user review; no merge/push/deploy.


## Verification outcome

- Full node:test suite: 1,162 passed, 0 failed, 3 skipped (1,165 total).
- TypeScript: passed. ESLint for every changed/new TypeScript file: passed.
- Production build: passed with DB_TYPE=sqlite and explicit worktree-local SQLITE_PATH/DESKRPG_HOME.
- Server integration: real registered DM socket handler + injected adapter + temporary SQLite; receipt-before-stream, history correlation and actual SQLite write rejection verified.
- Review: five server lifecycle findings and two client reset findings fixed and re-reviewed; no remaining findings.
- Chrome rendered the production response components and CSS; verified per-NPC statuses, receipts and no horizontal overflow. Preview retained in .artifacts/chat-response-ux/preview.png.
- Live Hermes E2E was not run. Gateway behavior is covered by existing adapter tests; this change's queue/socket/render integration used isolated fixtures rather than another session's DB or gateway.
- Receipt/progress records are ephemeral (bounded process memory); persisted message history remains in the DB. Server restart clears old receipt metadata.
- Retain feature branch and worktree for review. No merge, push or deployment.
