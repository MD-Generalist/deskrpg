# Trading reference map implementation plan

Goal: Rebuild the trading preset from the user reference with a real U-shaped floor, 24 work seats and reusable composition modules.
Architecture: Map data owns footprints, doors, furniture and roaming policy. Existing shared movement/reservations stay unchanged. Scene modules render the same footprint, shared PBR furniture and registered trade props.
Tech stack: TypeScript, Three.js, Tiled JSON, node:test, Playwright/GLB pipeline.
Spec: User-approved reference and design in this conversation (2026-09-15).

- [ ] Layout: freeze v2; compose 44×30 U floor (void cols18–25/rows19–29), 6×4 desks, left conference/private offices, right meetings/showroom/reception. Use common room/desk/lounge modules. Check all approaches with production geometry.
- [ ] Presentation: same floor mask drives true slab geometry, continuous outer frames and tile finish. Reuse shared navy chairs, oak desks, sofas, plants. Register ship/air displays, packing station and sample shelving with reproducible GLB source and PBR.
- [ ] Persistence: exact frozen v2 upgrades to v3 via existing backup/CAS, edited maps remain untouched; trusted oversized map validation remains exact.
- [ ] Verification: layout/seating/no-void traversal + asset bounds tests, reference overview/details, lint/type/build; render thumbnails using common capture. Full suite once integrated, broader repetition only for regression evidence.
- [ ] Release: reviewed clean master commit, predeploy and staging deployment; health/assets verification. No production release.

Quality: compare room distribution, desk count, furnishing density, finish and continuity. Static screenshots/draw budgets do not establish multiplayer FPS. Preserve user/profile/character/chat data. New roaming exclusions are policy data, not new path-engine branches.
