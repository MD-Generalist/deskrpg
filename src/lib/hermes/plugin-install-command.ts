import { PLUGIN_PIN } from "./setup/pin";

/**
 * The **single source of truth** for the `deskrpg-hermes-plugin` install command.
 *
 * Kanban (`kanban-view-model.ts`) and cron (`cron-api.ts`) used to each hold the same string,
 * and now the gateway onboarding guide shows the same command too. Instead of making a third copy,
 * we gather it here — if the repository address changes, there is one place to fix.
 */
const PLUGIN_REPO_URL = "https://github.com/dandacompany/deskrpg-hermes-plugin";

/**
 * Installs the plugin at the commit this app expects, or moves an existing install to it, then restarts
 * the gateway so the routes attach. One command covers both because the screens that show it cannot tell
 * a missing plugin from an outdated one on the user's behalf.
 *
 * The order is what upstream Hermes requires (checked against hermes_cli/plugins_cmd_install.py):
 * - `disable` first: a non-interactive `install --force` over an ENABLED plugin with Python dependencies
 *   is refused ("Reinstall declined"), and the old version stays. On a fresh host `disable` fails, which
 *   is why it is followed by `;` and silenced — Hermes prints its errors to stdout.
 * - `--force`: without it an existing install fails with "already exists". With nothing installed it is
 *   a plain install.
 * - `--no-enable`: skips the "Enable now?" prompt so a terminal and a script take the same path.
 * - `enable`: a replaced plugin stays disabled, and a disabled plugin answers 404 on every route. This
 *   step also prepares the plugin's dependencies.
 */
export const PINNED_PLUGIN_SETUP_COMMAND = `hermes plugins disable deskrpg >/dev/null 2>&1; hermes plugins install ${PLUGIN_REPO_URL} --ref ${PLUGIN_PIN} --force --no-enable && hermes plugins enable deskrpg && hermes gateway restart`;

/**
 * The command shown where the plugin is missing or too old (onboarding, kanban, cron, gate failures).
 * It used to be an unpinned `install && enable`, which failed with "already exists" in exactly the
 * "too old" case it was shown for.
 */
export const PLUGIN_INSTALL_COMMAND = PINNED_PLUGIN_SETUP_COMMAND;

/** The official Hermes Agent repository — where users who have not started a gateway yet should go. */
export const HERMES_AGENT_REPO_URL = "https://github.com/NousResearch/hermes-agent";
