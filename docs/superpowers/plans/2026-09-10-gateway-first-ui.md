# Gateway-first NPC workflow

User correction: NPCs derive from externally connected Hermes profiles. No independent NPC character creation. Gateway first; profile registration/selection then appearance.

- [x] Inspect existing gateway/profile/NPC ownership and player-avatar distinction.
- [x] Make gateways the authenticated landing and first navigation destination.
- [x] Add gateway-scoped NPC profile screen with loading/error/empty states and existing profile registration/edit controls.
- [ ] Resolve the independent human avatar flow with user input; remove standalone NPC creation routes.
- [ ] Verify profile ownership gating, no-gateway behavior, navigation, typecheck and browser.

Backend remains unchanged during the frontend navigation work. Existing human-character records are distinct from NPC profile records and cannot be passed as profile IDs.

Verified: TypeScript and ESLint pass; existing HermesProfileList tests 6/6. Chrome confirms authenticated gateway-first navigation and no-gateway NPC empty state with connection CTA. Awaiting user choice for human avatar vs observer before changing legacy character entry routes or channel admission.
