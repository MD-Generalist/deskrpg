# DeskRPG on Hostinger VPS (Docker Manager)

One VPS, two containers: **DeskRPG** (the virtual office) and **Hermes Agent** (the employees' brain). Everything runs 24/7 on the server, so your agents keep working and reporting after you close the laptop.

## 1. Traefik comes after DeskRPG

Traefik gives the office its HTTPS address, but hPanel shows the _"Enable HTTPS for Docker projects"_ banner with its **Deploy Traefik** button only **once a project exists** (seen 2026-09-17). So deploy DeskRPG first (step 2), then:

1. Press **Deploy Traefik** on the banner under the project list (it asks only for `ACME_EMAIL`).
2. DeskRPG project → **Manage** → Environment → add `TRAEFIK_HOST=srvNNNNNN.hstgr.cloud` → **Save and deploy**. This is required; see step 3. The redeploy also re-runs `traefik-connect` against the new Traefik.

After the DeskRPG deploy the project shows three containers: `deskrpg` and `hermes` running, and `traefik-connect` **exited** — that one-shot is supposed to be stopped. A VPS that already has Traefik shows no banner; just press Update.

### Both Traefik shapes work (measured 2026-09-17)

Two Traefik shapes show up on Hostinger VPSes, and each one breaks a naive compose:

| Traefik shape                                                                             | How it reaches DeskRPG          | What breaks it                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **host mode** — `network_mode: host`, no networks (what hPanel installed on a user's VPS) | the container's bridge IP       | declaring `traefik-proxy` as `external: true` — `network traefik-proxy declared as external, but could not be found`, shown by Hostinger only as a project stuck at `created` whose logs read "Docker project not found" |
| **bridge mode** — Traefik on a `traefik-proxy` network                                    | only containers on that network | letting this compose create `traefik-proxy` (Compose refuses to adopt a network it did not create), or joining it without the `traefik.docker.network` label (Traefik dials the wrong IP)                                |

So the compose declares no Traefik network. Instead the one-shot `traefik-connect` service joins `deskrpg` to `traefik-proxy` **only when that network exists**, and the `traefik.docker.network=traefik-proxy` label tells bridge-mode Traefik which IP to use; host mode ignores a label naming a missing network.

Measured with both shapes: first deploy, full recreate, a new image recreating only `deskrpg`, container restart, and Hostinger's own **Update** all routed 10/10 — Update re-runs the exited connector. One gap: `docker compose up -d deskrpg` **with a service name** does not run the connector, so bridge-mode Traefik loses the route. Run `docker compose up -d` without a service name, or press Update.

`traefik-connect` mounts the Docker socket **read-write** (`docker network connect` writes), which is host-root equivalent. It runs only the fixed script in the compose and exits within seconds.

## 2. One-click

[![Deploy on Hostinger](https://assets.hostinger.com/vps/deploy.svg)](https://www.hostinger.com/vps/docker-hosting?compose_url=https://raw.githubusercontent.com/dandacompany/deskrpg/refs/heads/master/docker-compose.yml)

No VPS yet? [Get one here first](https://hostinger.com/DANTE-HERMES) — a referral link that supports this project at no extra cost to you. It lands on Hostinger's offer page, not on Docker Manager, so buy there and then press the button above.

The button opens Docker Hosting. Pick **KVM 2** (2 vCPU / 8 GB — Hostinger's own minimum for Hermes), finish checkout, and Docker Manager opens with this compose already loaded.

Already have a VPS? hPanel → VPS → **Docker Manager** → **Compose** → **Compose from URL** → paste:

```
https://raw.githubusercontent.com/dandacompany/deskrpg/refs/heads/master/docker-compose.yml
```

Project name: `deskrpg` (3–64 chars, letters/digits/`-`/`_`).

## 2-1. Before you press Deploy

The **Environment** box is pre-filled from `.env.example`. Set one value:

```
HERMES_API_KEY=<output of: openssl rand -hex 32>
```

- `JWT_SECRET` — leave the placeholder. The app generates a real key into the `deskrpg-data` volume and reuses it across restarts and Update. A value you set always wins.
- `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — optional; see step 4-1 for which one to fill, or leave all empty to log in with ChatGPT.

## 3. Your HTTPS URL

After Traefik (step 1) and Deploy (step 2), the office is reachable at:

```
https://deskrpg.<srvNNNNNN.hstgr.cloud>
```

**`TRAEFIK_HOST` is not injected — set it yourself.** Measured 2026-09-17: with Traefik running and the variable empty, the routing rule becomes `deskrpg.localhost`, Traefik answers 404 and Docker Manager's **Open** link points at `deskrpg.localhost`. Project → **Manage** → Environment → **+ Environment** → `TRAEFIK_HOST=srvNNNNNN.hstgr.cloud` (the name in the hPanel breadcrumb) → **Save and deploy**; Let's Encrypt then issues the certificate.

Custom domain: point an `A` record at the VPS IP and change the `Host(...)` rules to your domain.

## 4. Firewall

hPanel → VPS → Security → Firewall: allow **22, 80, 443** only. Do **not** open 3000, 3001, 8642 or 9119 — Traefik is the only public door, and Hermes' API server is reachable from DeskRPG on the private Docker network.

## 4-1. Give Hermes a model

Hermes boots without any provider, and then answers every message with `Provider authentication failed`. Pick **one** route (all measured 2026-09-17). Terminal commands run over SSH from the project folder:

```bash
ssh root@<VPS IP>
cd /docker/deskrpg          # Docker Manager keeps each project in /docker/<project name>
```

**A. ChatGPT login (Codex OAuth)** — no API key.

```bash
docker compose exec hermes hermes auth add openai-codex --type oauth --no-browser
# open the printed URL on any device, enter the code, approve
docker compose exec hermes hermes config set model.provider openai-codex
docker compose exec hermes hermes config set model.default gpt-5.5
```

Skipping the two `config set` lines leaves Hermes on its default model (`anthropic/claude-opus-4.6`): Codex rejects it with `model is not supported when using Codex`, and if an OpenRouter key is also set Hermes keeps using OpenRouter. No restart needed; the login lives in `hermes-data` and survived Update in the test.

**B. API key** (filled in the Environment box before Deploy):

| Key                  | Extra steps                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | none                                                                               |
| `ANTHROPIC_API_KEY`  | none; set `model.provider anthropic` and `model.default` to avoid the Opus default |
| `OPENAI_API_KEY`     | **required** — the key alone is ignored and requests still go to OpenRouter        |

```bash
# OpenAI key only
docker compose exec hermes hermes config set model.provider openai-api
docker compose exec hermes hermes config set model.default gpt-5.5
docker compose exec hermes hermes config unset model.base_url   # otherwise the key is not sent
```

`docker compose exec` as root is fine: the image's `hermes` wrapper drops to the `hermes` user, so file ownership stays correct.

## 4-2. Install the DeskRPG plugin — required

From the same `/docker/deskrpg` shell. DeskRPG reads the Hermes profile list, kanban, cron and
events through [`deskrpg-hermes-plugin`](https://github.com/dandacompany/deskrpg-hermes-plugin). Without it
the gateway connection in step 5 is saved but stops at _"API 연결은 저장되었지만 DeskRPG 플러그인이 없어…"_ with
no way to reach the profile list — and on a VPS the offered **Install via SSH** button is disabled
(host setup is off), so you cannot hire employees. Install it before connecting:

```bash
docker compose exec hermes hermes plugins install https://github.com/dandacompany/deskrpg-hermes-plugin
docker compose exec hermes hermes plugins enable deskrpg
docker compose restart hermes
```

`enable` is not optional — without it every plugin route answers 404 even though the install
succeeded, and DeskRPG's board screen keeps telling you the plugin is missing. The plugin lives in
the `hermes-data` volume, so it survives Update. Verify:

```bash
docker compose exec hermes sh -lc 'curl -s -H "Authorization: Bearer $API_SERVER_KEY" http://127.0.0.1:8642/deskrpg/info'
```

## 5. Connect the office to Hermes

1. Open your DeskRPG URL, create the first account (it becomes admin).
2. Top-right menu → **My Gateways** → **New gateway** → URL `http://hermes:8642`, token = your `HERMES_API_KEY` → **Test connection**.
3. Open the profile list (each Hermes profile = one employee). The plugin from step 4-2 discovers it automatically.
4. Enter a channel → Settings → **AI Connection** → attach the gateway → hire NPCs.

Already running Hermes elsewhere (your laptop, another VPS)? Delete the `hermes` service from the compose and use your own API server URL in step 2. Hermes profiles you already have show up as employees — nothing to migrate.

## 6. Kanban and cron

With the plugin from step 4-2 in place, kanban boards, the event stream and schedules work out of the box. Set `timezone:` in Hermes' `config.yaml` if you schedule anything — cron times are read in that zone.

## 7. Day-2

Docker Manager → project → **Options**: Restart / Update (edit YAML, re-create) / View logs / Delete. **Access → Terminal** opens a shell in the container. Data lives in the named volumes `deskrpg-data` (SQLite + uploads) and `hermes-data` (`~/.hermes`) and survives Update.

## How Docker Manager reads this repo (measured 2026-09-16)

- **It always takes the repo-root `docker-compose.yml`.** A raw URL for a file in a
  subdirectory is resolved back to the root — a URL for
  `deploy/hostinger/docker-compose.yml` deployed the root file instead. That is why the
  compose lives at the repo root and must stay there.
- **It pre-fills the Environment box from the repo-root `.env.example`, verbatim.** That box
  has no comment syntax, so a line starting with `#` becomes a variable named `# FOO` and is
  rejected as an invalid name. `.env.example` is therefore kept comment-free; the prose lives
  in [`ENVIRONMENT.md`](../../ENVIRONMENT.md).
- The API takes the compose as a URL, a GitHub repository URL, or raw YAML, and `environment`
  as one `KEY=value` string. **Both** `environment` and raw-YAML `content` are capped at
  **8 192 characters** — a 8 654-character compose was rejected with `The content field must
not be greater than 8192 characters` (2026-09-17). Keep long explanations here, not in the
  compose; `src/lib/hostinger-compose.test.js` enforces the cap.
- `build:` is used by Hostinger's own template repo, so it is presumably supported. This
  compose does not use it — a published image is faster to deploy and easier to pin.

## Constraints baked into the compose

- Every `${VAR}` has a default so an empty environment box still boots.
- App ports are not published; Traefik routes `/socket.io` to the internal Socket.IO port (3001) and everything else to Next.js (3000), same-origin.
- SQLite mode; switch to Postgres by adapting `docker/docker-compose.external.yml` if you need multi-instance.
