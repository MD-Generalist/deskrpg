"use client";

/**
 * SSH 호스트 등록 — DeskRPG 전용 키의 공개키를 보여 주고, 호스트 키 지문을 확인받아 고정한다.
 *
 * 1. 공개키 복사 → 관리자가 대상 서버 `~/.ssh/authorized_keys` 에 붙인다(개인키는 서버 밖으로 나가지 않는다).
 * 2. 호스트·포트·사용자 입력 → 서버가 `ssh-keyscan` 으로 받은 지문을 보여 준다.
 * 3. "지문이 맞습니다" 확인 → 서버가 다시 스캔해 같을 때만 등록한다.
 *
 * 관리자 전용이다(서버가 판정). 비밀번호는 받지 않는다.
 */
import { useEffect, useState, type JSX } from "react";

import { CopyCommand } from "@/components/CopyCommand";
import { useLocale, useT } from "@/lib/i18n";

import { setupCopy, setupError } from "./setup-copy";

const API = "/api/gateways/setup";
const button =
  "rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50";
const secondary =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-raised disabled:opacity-50";
const input =
  "w-full rounded border border-border bg-bg px-3 py-2 text-text focus:outline-none focus:border-primary";

type ScannedKey = { type: string; fingerprint: string };

/** 등록 단계에서 자주 나는 코드는 무엇을 하면 되는지까지 말한다. 나머지는 마법사 공통 문구. */
const SSH_ERROR_KEYS: Record<string, string> = {
  ssh_connection_failed: "hermes.wizard.ssh.errors.unreachable",
  ssh_unavailable: "hermes.wizard.ssh.errors.noTools",
  ssh_host_key_failed: "hermes.wizard.ssh.errors.keyChanged",
  setup_invalid_request: "hermes.wizard.ssh.errors.invalid",
};

function errorCode(err: unknown): string | undefined {
  const code = (err as { errorCode?: unknown } | null)?.errorCode;
  return typeof code === "string" ? code : undefined;
}

async function post<T>(body: object): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data as T;
}

/** 대상 서버에서 한 번 실행할 명령 — 공개키를 authorized_keys 에 붙인다. */
export function authorizeCommand(publicKey: string): string {
  const quoted = `'${publicKey.replace(/'/g, "'\\''")}'`;
  return `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo ${quoted} >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
}

export default function SshHostRegistration({
  onRegistered,
  onCancel,
}: {
  onRegistered(host: { id: string; label: string }): void;
  onCancel?(): void;
}): JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [keys, setKeys] = useState<ScannedKey[] | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    post<{ publicKey: string }>({ action: "ssh-public-key" })
      .then((data) => !cancelled && setPublicKey(data.publicKey))
      .catch((err) => !cancelled && setError(err));
    return () => {
      cancelled = true;
    };
  }, []);

  const target = { host: host.trim(), port: port.trim(), user: user.trim() };
  const ready = Boolean(target.host && target.user && /^\d{1,5}$/.test(target.port));

  const scan = async () => {
    setBusy(true);
    setError(null);
    setKeys(null);
    setConfirmed(false);
    try {
      const data = await post<{ keys: ScannedKey[] }>({ action: "ssh-scan", ...target });
      setKeys(data.keys);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    if (!keys) return;
    setBusy(true);
    setError(null);
    try {
      const data = await post<{ host: { id: string; label: string } }>({
        action: "ssh-register",
        ...target,
        fingerprints: keys.map((k) => k.fingerprint),
      });
      onRegistered(data.host);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-border bg-bg p-4" data-ssh-registration>
      <div className="space-y-2">
        <h3 className="font-semibold">{t("hermes.wizard.ssh.keyTitle")}</h3>
        <p className="text-sm text-text-muted">{t("hermes.wizard.ssh.keyBody")}</p>
        {publicKey ? (
          <CopyCommand command={authorizeCommand(publicKey)} />
        ) : (
          !error && <p className="text-sm text-text-muted">{t("common.loading")}</p>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">{t("hermes.wizard.ssh.hostTitle")}</h3>
        <div className="grid gap-2 sm:grid-cols-[1fr_6rem_10rem]">
          <input
            className={input}
            name="ssh-host"
            placeholder={t("hermes.wizard.ssh.hostPlaceholder")}
            value={host}
            onChange={(e) => {
              setHost(e.target.value);
              setKeys(null);
            }}
          />
          <input
            className={input}
            name="ssh-port"
            inputMode="numeric"
            placeholder="22"
            value={port}
            onChange={(e) => {
              setPort(e.target.value);
              setKeys(null);
            }}
          />
          <input
            className={input}
            name="ssh-user"
            placeholder={t("hermes.wizard.ssh.userPlaceholder")}
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              setKeys(null);
            }}
          />
        </div>
        <button className={secondary} disabled={busy || !ready} onClick={() => void scan()}>
          {busy && !keys ? t("hermes.wizard.ssh.scanning") : t("hermes.wizard.ssh.scan")}
        </button>
      </div>

      {keys && (
        <div className="space-y-2" data-ssh-fingerprints>
          <p className="text-sm text-text">{t("hermes.wizard.ssh.fingerprintBody")}</p>
          <ul className="space-y-1 font-mono text-xs">
            {keys.map((k) => (
              <li key={k.fingerprint}>
                {k.type} <span className="text-text">{k.fingerprint}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-muted">{t("hermes.wizard.ssh.fingerprintHow")}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="ssh-fingerprint-confirm"
              className="mt-1 accent-primary"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>{t("hermes.wizard.ssh.fingerprintConfirm")}</span>
          </label>
          <button className={button} disabled={busy || !confirmed} onClick={() => void register()}>
            {t("hermes.wizard.ssh.register")}
          </button>
        </div>
      )}

      {Boolean(error) && (
        <p role="alert" className="text-sm text-danger">
          {SSH_ERROR_KEYS[errorCode(error) ?? ""]
            ? t(SSH_ERROR_KEYS[errorCode(error) ?? ""])
            : setupError(setupCopy[locale], errorCode(error))}
        </p>
      )}
      {onCancel && (
        <button className="text-sm text-text-muted underline" onClick={onCancel}>
          {t("hermes.wizard.ssh.cancel")}
        </button>
      )}
    </div>
  );
}
