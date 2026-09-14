# Hostinger Docker Manager catalog — submission package for DeskRPG

Hostinger's catalog has no public submission form; this package is what we send to our partnership contact.

## App metadata

- **Name**: DeskRPG
- **Tagline**: Self-hosted 3D virtual office where your Hermes Agent profiles work as employees — chat, meetings, kanban, and walk-up reports.
- **Category**: AI / Agents
- **Homepage**: https://deskrpg.com · **Source**: https://github.com/dandacompany/deskrpg · **License**: MIT
- **Logo**: `public/icon-512.png` (square, transparent) — attach as PNG/SVG
- **Docs**: `deploy/hostinger/README.md`

## Compose

`deploy/hostinger/docker-compose.yml` (single file, image-only, no `env_file`, defaults for every variable, Traefik labels for `traefik-proxy`).

## Input form (what the catalog should ask the user)

| Variable | Label | Type | Required | Default / help |
|---|---|---|---|---|
| `JWT_SECRET` | Session secret | password, auto-generate | yes | random 64 hex |
| `HERMES_API_KEY` | Hermes API key | password, auto-generate | yes | random 64 hex; shown back to the user for the "New gateway" step |
| `OPENROUTER_API_KEY` | Model provider key (OpenRouter) | password | no | leave empty if you use OpenAI/Anthropic keys instead |
| `OPENAI_API_KEY` | OpenAI key | password | no | |
| `ANTHROPIC_API_KEY` | Anthropic key | password | no | |

## Post-install message (shown after Deploy)

> Open `https://deskrpg.<your-host>` and create the first account. Then **My Gateways → New gateway**: URL `http://hermes:8642`, token = your Hermes API key. Add a profile, attach the gateway to a channel, and hire your first employee.

## Recommended plan

KVM 2 (2 vCPU / 8 GB). SQLite mode, no external database.

## Referral

Please provide the `REFERRALCODE` to append to the Deploy on Hostinger button and the tracking link for the Docker Hosting landing page.
