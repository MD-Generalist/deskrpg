# Office lookbook: approved design

User approved the supplied five K-drama office reference sheets as the design direction on 2026-09-10. Build an initial ten complete original characters and five complete office environments in the existing UI2 worktree. Keep the warm miniature world, use approximately 3.5-head proportions, and make clothing silhouettes, hair, glasses and bags visible in geometry. Name and profession are independent of appearance. Include varied skin, age and body shape. The remaining forty looks are subsequent work.

Replace the player's part editor with a searchable/filterable gallery and a large rotatable/walking model preview. Keep existing characters intact until a replacement is explicitly selected. Store an optional officeLookId alongside valid legacy bodyType/layers using the unchanged JSON API. Unknown IDs fall back safely. Use the same model catalog in preview, world and meetings. NPC profile appearance uses the same complete-look catalog; it preserves unknown/legacy appearance until an explicit selection.

Trading-company preset: standard Tiled objects, desks/computers/chairs, leader desk, meeting space, archives, pantry, open entrance and connected walkable aisles. Add to new-project selection, never overwrite existing maps. No backend/API/DB/socket changes; no deployment or merge in this step.

Validation: persisted appearance passes existing validator; JSON roundtrip resolves stable identity; unknown/legacy IDs safe; model silhouette differences and resources validated; map flood-fill and unique IDs; typecheck, tests, build and Chrome UI save/reload plus 3D map preview.

## Approved map scope update
Five fixed environments: trading, agency, tech, executive, publishing. Channel creation offers selection and a live 3D preview. Register/reuse exact version-tagged snapshots via existing map-template API, then use its ID with the unchanged channel creation API. No editor, furniture or palette controls in primary navigation/game. Preserve legacy editor routes and data. Standard dimensions 30×22; all entrances and seats reachable.

## Phase 2 completed
Expand to 50 original office characters using the supplied K-drama wardrobe direction. Existing first-ten identifiers/data remain stable. Added structural hair/garment/prop options and incremental cancellable thumbnail generation. All appearances retain the existing backend contract.
