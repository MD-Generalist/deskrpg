# Releasing DeskRPG

Production deployment and public release are separate operations. A `master` push makes an **amd64 production candidate**, not an npm or public-version release. A date tag makes the npmjs.org, multi-platform GHCR, and GitHub Release artifacts. Docker Hub is legacy; no new build is pushed there.

## Before you push: the local gate

```bash
git config core.hooksPath .githooks   # once per clone or worktree
```

`.githooks/pre-push` runs `format:check`, `typecheck` and `lint` (about 30 s) and
refuses the push when any of them fails. `git push --no-verify` skips it when you
mean to. Tests and `build` are deliberately left out — together they take four to
five minutes, and a gate that slow turns `--no-verify` into a habit, which is the
same as having no gate. CI still runs everything.

## Production: fast commit-SHA path

CI (`.github/workflows/ci.yml`) builds on a native x64 GitHub runner and pushes `ghcr.io/dandacompany/deskrpg:sha-<full-master-commit-sha>` in parallel with tests, typecheck, lint, Next build, and formatting. PRs build without pushing. Publishing an image does **not** change `deskrpg.com`.

Before operating on DanteServer:

1. In a clean checkout of the exact candidate SHA, run `npm ci` and `npm run format:check` before any promotion. An ignored local file or a successful Docker job does not prove that the public Git tree is formatted.
2. Confirm the exact `master` commit's CI `verify` and `docker` jobs are both green (`gh run list --workflow CI --commit <SHA>` and `gh run view <RUN_ID>`). Do not deploy a failed or merely pending candidate.
3. Confirm the GHCR SHA image has `linux/amd64`, is anonymously pullable, and record its digest. Use the digest for the production pin rather than a mutable tag.
4. Keep existing `.env.production`, PostgreSQL data, uploads, and volume mounts unchanged. Back up the current production compose/image pin. Change only `DESKRPG_IMAGE` or the compose image reference, then `docker compose pull deskrpg-app && docker compose up -d deskrpg-app` (use the actual remote service name).
5. Check the public `/auth` route, Socket.IO, and DB connection; if unhealthy, restore the previous digest/image pin and repeat pull/up. Do not use `docker compose down -v`.

This is a manual production promotion convention, not a GitHub Actions SSH auto-deploy. No GitHub SSH deployment secret is required. See the live server compose before choosing its exact service name or editing its image pin.

## Public release: date-tag path

Release only from a verified, clean `master`. Use a fresh date version (no `v` prefix); published npm versions are immutable.

### Version bump rule

- One release on a given day: `YYYY.M.D` (e.g. `2026.9.22`).
- **A second release on the same day does not borrow a future date.** It bumps a sequence number instead: `YYYY.MMDD.N` — major = year, minor = zero-padded `MMDD`, patch = the day's sequence starting at `1`. The second release on 2026-09-22 is `2026.922.1`, the third `2026.922.2`.
- Why not `2026.9.22.1`: npm versions are semver, which has exactly three numeric components. `npm version 2026.9.22.1` is rejected, so a fourth segment cannot ship.
- The same shape also rescues a version line that ran ahead of the calendar. On 2026-09-16 the
  published version was already `2026.9.22` because four releases on 2026-09-15 each borrowed a
  future date; `2026.9.16` would have sorted _below_ what was live. `2026.916.1` sorts above it and
  puts the date back in step with reality, so use it whenever today's plain `YYYY.M.D` would be
  lower than what is already published.
- Ordering holds across the switch and forever after: `2026.9.22` < `2026.922.1` < `2026.923.1` < `2027.101.1`, because the minor grows with `MMDD` through the year and the major with the year.
- The tag glob in `.github/workflows/release.yml` (`20[0-9][0-9].[0-9]*.[0-9]*`) already matches both shapes; no workflow change is needed. `2026.9.19` remains broken for npm installs and **must not be reused**. The npm `node_modules` alias fix (`56794fb9`) is included in the next tag.

1. Update `package.json` and `package-lock.json`, and the version lines in `README.md`/`README.ko.md`. The in-app version is read from `package.json` (`src/lib/app-meta.ts`), so there is no source constant to bump. Remove the temporary npm `2026.9.18`/`2026.9.19` warning from both READMEs after validating the fixed tarball. The tag must equal the package version. Do **not** pin `docker-compose.yml`: its `DESKRPG_IMAGE` default is `ghcr.io/dandacompany/deskrpg:latest` so Hostinger's **Update** upgrades existing installs (Update re-pulls the saved compose's images and never re-reads the URL — measured 2026-09-17). `src/lib/hostinger-compose.test.js` fails on a pinned default. README and `deploy/office` pin examples use a `<release tag>` placeholder and need no bump. Leave historical minimum-version notes (for example the npm `2026.9.20`-or-later warning) alone.
2. In a clean checkout of the release commit, run `npm ci` and `npm run format:check` before the more expensive `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm pack --dry-run`. Confirm the npm tarball contains the runtime assets and `src/lib/path-alias.js`. If Prettier reports files, format only those files, commit the result, and rerun the gates on the new SHA. Never tag or publish while that SHA's `master` CI is red.
3. Push the version commit to `master`, wait for its CI to turn green, then create and push the date tag. Only the tag triggers `.github/workflows/release.yml`.

The release workflow checks that the tag commit is on remote `master`, verifies version consistency, and **first smoke-tests the built npm tarball from `node_modules` before publishing**. Then it publishes npm with provenance (`NPM_TOKEN`), waits for registry propagation, installs that exact **registry package globally under a temporary prefix**, starts it from `node_modules`, and requires `/auth` to answer. Its Docker jobs build `linux/amd64` on `ubuntu-24.04` and `linux/arm64` on `ubuntu-24.04-arm` in parallel, without QEMU. They push platform tags to `ghcr.io/dandacompany/deskrpg:<VERSION>-amd64` and `:<VERSION>-arm64`. **Only after the registry npm smoke succeeds** does the manifest job join them as `:<VERSION>` and `:latest`, check both platforms, and check anonymous visibility. GitHub Release is created only after npm and manifest jobs succeed.

The only repository publishing secret is `NPM_TOKEN`. GHCR uses the workflow's `GITHUB_TOKEN` with `packages: write`. If the first package is not public, set its visibility to public in GitHub's package settings and rerun the manifest job; never announce a private container as a public release.

## Transition and verification

The migration to GHCR is complete as of `2026.9.20`: that tag and `:latest` passed the anonymous pull check, so every Compose default, the Hostinger button and both READMEs now point at `ghcr.io/dandacompany/deskrpg`. Docker Hub `dandacompany/deskrpg` is frozen at `2026.9.19` and is never published to again. The rule that produced this order still stands: never point a default at a GHCR tag that does not yet exist — bump defaults only after the release run has published and verified the tag.

The Hostinger `compose_url` now tracks `refs/heads/master` instead of a release tag. A tag-pinned URL always lagged one release — the button had to name the tag before the tag existed, so its compose could never contain the image that release published. The compose defaults to `:latest`, so neither the URL nor the compose needs a per-release bump. `:latest` is only moved after the npm registry smoke and the two-platform manifest checks pass, which is what makes it safe as a default. Users who need reproducibility pin `DESKRPG_IMAGE=ghcr.io/dandacompany/deskrpg:<release tag>` in the Docker Manager environment.

After the next release, verify:

```bash
npm view deskrpg version
docker buildx imagetools inspect ghcr.io/dandacompany/deskrpg:<VERSION>
docker pull ghcr.io/dandacompany/deskrpg:<VERSION>
gh release view <VERSION>
```

Also check the npm CLI smoke job result, the public package page, amd64 and arm64, and the live production commit independently. A public release does not automatically promote itself to `deskrpg.com`.
