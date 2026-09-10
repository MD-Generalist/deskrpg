"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { getLocalizedErrorMessage } from "@/lib/i18n/error-codes";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import { Armchair } from "lucide-react";

const AuthOfficeScene = dynamic(() => import("@/components/AuthOfficeScene"), { ssr: false });

const isComingSoon = process.env.NEXT_PUBLIC_COMING_SOON === "true";
const isRegistrationDisabled = process.env.NEXT_PUBLIC_REGISTRATION_DISABLED === "true";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginId, setLoginId] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    Promise.all([
      fetch("/api/characters", { redirect: "manual" }),
      fetch("/api/auth/status")
        .then((r) => (r.ok ? r.json() : { hasUsers: true }))
        .catch(() => ({ hasUsers: true })),
    ])
      .then(([charRes, status]) => {
        if (charRes.ok) {
          router.replace("/characters");
        } else {
          setHasUsers(status.hasUsers);
          if (!status.hasUsers) setMode("register");
          else if (isRegistrationDisabled) setMode("login");
          setChecking(false);
        }
      })
      .catch(() => {
        setChecking(false);
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload = mode === "login" ? { loginId, password } : { loginId, nickname, password };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(getLocalizedErrorMessage(t, data));
        return;
      }

      router.push("/characters");
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="theme-web min-h-screen flex items-center justify-center bg-bg text-text">
        {t("auth.checkingAuth")}
      </div>
    );
  }

  return (
    <div className="theme-web auth-office">
      <div className="auth-office-scene" aria-hidden="true">
        <div className="auth-office-visual">
          <AuthOfficeScene />
          <div className="auth-office-model">
            <span className="office-window" />
            <span className="office-desk" />
            <span className="office-plant" />
            <Armchair size={100} strokeWidth={1.2} />
          </div>
        </div>
        <div className="auth-office-wordmark">
          DeskRPG<small>LITTLE OFFICE</small>
        </div>
      </div>

      {/* Language switcher */}
      <div className="fixed top-4 right-4 z-30">
        <LocaleSwitcher />
      </div>

      {/* Login card - centered */}
      <div className="auth-office-form">
        <div className="w-full max-w-[420px]">
          {/* Title */}
          <div className="text-center mb-4">
            <h1 className="text-4xl font-bold tracking-tight text-text">DeskRPG</h1>
            <p className="text-xs text-primary tracking-widest mt-3">{t("auth.heroTagline")}</p>
            <p className="mt-3 text-sm text-text-secondary">{t("auth.heroSubtitle")}</p>
          </div>

          {/* Card */}
          <div className="auth-office-card">
            {isComingSoon ? (
              <div className="text-center">
                <div className="text-2xl font-bold text-text mb-5">{t("auth.comingSoon")}</div>
                <a
                  href="https://github.com/dandacompany/deskrpg"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block w-full py-2.5 rounded-lg text-text font-semibold text-sm text-center"
                  style={{
                    background: "var(--color-primary)",
                    boxShadow: "0 3px 0 rgba(41,74,58,0.15)",
                  }}
                >
                  {t("auth.comingSoonGithub")}
                </a>
              </div>
            ) : (
              <>
                {/* Tab switcher — hidden during fresh setup or when registration is disabled */}
                {hasUsers && !isRegistrationDisabled && (
                  <div className="flex mb-5 rounded-lg overflow-hidden border border-border">
                    <button
                      onClick={() => setMode("login")}
                      className={`flex-1 py-2.5 text-center text-sm font-semibold transition-colors ${
                        mode === "login"
                          ? "bg-primary text-white"
                          : "bg-bg-deep text-text-dim hover:text-text-secondary"
                      }`}
                    >
                      {t("auth.login")}
                    </button>
                    <button
                      onClick={() => setMode("register")}
                      className={`flex-1 py-2.5 text-center text-sm font-semibold transition-colors ${
                        mode === "register"
                          ? "bg-primary text-white"
                          : "bg-bg-deep text-text-dim hover:text-text-secondary"
                      }`}
                    >
                      {t("auth.register")}
                    </button>
                  </div>
                )}

                {/* Fresh install description */}
                {!hasUsers && (
                  <p className="text-center text-sm text-text-secondary mb-5">
                    {t("auth.setupDescription")}
                  </p>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    type="text"
                    placeholder={t("auth.loginIdPlaceholder")}
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    className="w-full px-4 py-2.5 bg-bg-deep text-text rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary-light text-sm placeholder-text-dim"
                    minLength={2}
                    maxLength={50}
                    required
                  />
                  {mode === "register" && (
                    <input
                      type="text"
                      placeholder={t("auth.displayNamePlaceholder")}
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="w-full px-4 py-2.5 bg-bg-deep text-text rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary-light text-sm placeholder-text-dim"
                      minLength={2}
                      maxLength={50}
                      required
                    />
                  )}
                  <input
                    type="password"
                    placeholder={t("auth.passwordPlaceholder")}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 bg-bg-deep text-text rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary-light text-sm placeholder-text-dim"
                    minLength={4}
                    required
                  />
                  {error && <p className="text-danger text-sm">{error}</p>}
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 rounded-lg text-white font-semibold text-sm disabled:opacity-50 mt-2"
                    style={{
                      background: "var(--color-primary)",
                      boxShadow: "0 3px 0 rgba(41,74,58,0.15)",
                    }}
                  >
                    {loading
                      ? mode === "login"
                        ? t("auth.loggingIn")
                        : t("auth.registering")
                      : !hasUsers
                        ? t("auth.getStarted")
                        : mode === "login"
                          ? t("auth.login")
                          : t("auth.register")}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
