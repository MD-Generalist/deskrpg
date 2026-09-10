# Chat response UX

Approved in conversation: isolated worktree, live group/DM answers, per-NPC receipt and progress, FIFO handling of additional human calls. Receipt emoji finalized as 👌.

## User experience
Show 👌 plus NPC names under the source message after server admission. Show queued, thinking, or answering separately per request/NPC. Stream into one reply; finalize that reply without duplication. Failed/cancelled requests stop animating and retain an explicit status. Tool output and internal reasoning never become answer text.

## Contract
A shared ChatResponse record contains requestId, sourceMessageId, npcId, npcName, status (queued/thinking/streaming/complete/failed/cancelled), content (cumulative sanitized answer), updatedAt (epoch milliseconds), optional messageId (ID exposed by history: room DB ID or DM correlation ID after successful persistence), optional error. room:response-state carries {roomId,response}; room:response-snapshot carries {roomId,responses}. npc:response-state carries {response}; npc:response-snapshot carries {npcId,responses}. DM client sends sourceMessageId with npc:chat. Legacy DM response events may carry responseRequestId to avoid double rendering by upgraded clients. Room source IDs are saved human message IDs.

## Execution
Serialize human requests per NPC/session, while different NPCs run concurrently. Preserve each request's caller and prompt context. Keep automatic NPC mention chains budgeted and avoid queue deadlocks. Bound queued work and emit explicit rejection; do not silently drop human calls. Invalidation cancels queued and active room work. Snapshot active/recent states on room open and DM history; disconnect clears live client animation until snapshot restores it. Store receipts in bounded process memory for now; completed chat history remains the existing DB source of truth. Server restart drops ephemeral receipts, never leaves claims of active work.

## Verification
Runtime FIFO/caller/context tests, streamed-before-completion test, error/cancellation/late-chunk tests, response reducer interleaving/deduplication/snapshot tests, rendered receipt/status tests; existing unit suite, TypeScript and scoped lint. Real gateway/browser tests use isolated data and port only when available.
