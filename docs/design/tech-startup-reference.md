# Tech startup reference map — v3

Approved reference: user-supplied 테크 스타트업.png (2026-09-15). Rebuild the tech preset with a 2.2:1 rectangular footprint (44×20 tiles). Current implementation uses the same actor, networking, navigation and seat machinery as the other offices.

## Spatial program

| Zone | Program |
|---|---|
| Rear left | Two server racks in a glazed enclosure; two acoustic booths |
| Left wall | Four connected hardware workbench modules, tools, electronics and storage |
| Rear middle | Glass-enclosed six-seat sprint meeting room |
| Open office | Two facing eight-seat developer desk islands,16 work seats total |
| Rear right | Collaboration bar with three stools and mobile board |
| Right | Kitchen run with refrigerator and coffee equipment, five-seat island |
| Front right | Modular blue L sofa, two green beanbags, low table and pale woven rug |

40 active seat anchors:22 chairs,10 stools,6 sofa places,2 beanbags. Acoustic booths are visual props in this revision; their interior desk is not an additional navigable seat. Bounds are intentionally conservative and a booth remains a solid object until a dedicated enter/exit interaction is designed.

## Reuse and appearance

- Shared furniture uses the existing GLB catalog with blue, mint and graphite instance variants.
- Tech-specific authored assets and reproducible sources: `tech-startup-assets.ts`, `scripts/assets/build-tech-startup.cjs`, `public/assets/shared/tech/`.
- Concrete uses deterministic aggregate texture and subtle expansion joints. Blue collaboration rug and pale lounge rug use woven bump detail.
- Existing PMREM lighting provides approximate environmental reflections. This is not a ray-traced recreation of the supplied image.
- Coordinates are meters, Y-up, +Z-front, floor-centered. Visual geometry must fit the registered footprint; seating continues to use shared anchors and reservations.
- New asset geometry, bounds, triangle counts and exports must pass `three-asset-quality-checklist.md`; final visual acceptance requires browser captures, not only passing tests.

## Persistence and upgrade

Only complete matches to the frozen `official-tech-v2.json` upgrade automatically. Edited maps stay unchanged. The existing channel backup/CAS upgrade path handles persistence; map version3 and template tag must agree. Server/focus/meeting zones have independent roaming policy.

## Verification

- Validate all40 seat approaches through production body-clear navigation.
- Verify exact legacy upgrade and reject altered snapshots or oversized forged templates.
- Use `node scripts/assets/verify-tech-startup.cjs /tmp/tech-review` for real renderer overview/detail and asset-load checks.
- Headless GPU results are visual evidence only; they do not establish desktop performance or multiplayer persistence.

## Verified implementation (2026-09-15)

Production build and the 13 tech-specific regression tests pass. The actual renderer capture reports 40 seat anchors, 15 loaded asset identities, 2,869,168 asset bytes and zero asset/browser errors. After shared static batching the empty scene uses 59 draw calls and 433,688 triangles at 1748×900, DPR 1. These are a manually stepped, zero-actor fixture, not an FPS or multiplayer benchmark. Final captures: `/tmp/deskrpg-tech-v3-release/tech-overview.png` and `tech-detail.png`; regenerate with the verification script above.
