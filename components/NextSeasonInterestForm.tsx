"use client";

import { useEffect, useMemo, useState } from "react";
import { UiButton } from "@/components/ui";

type NextSeasonInterestFormProps = {
  season: number;
};

type InterestResponse = {
  ok?: boolean;
  error?: string;
};

const SUBMIT_COOLDOWN_MS = 15_000;
const SUBMIT_COOLDOWN_KEY = "afl_next_season_interest_last_submit_ms";

function readCooldownLeft() {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(SUBMIT_COOLDOWN_KEY);
  const last = raw ? Number(raw) : 0;
  if (!last || Number.isNaN(last)) return 0;
  const left = SUBMIT_COOLDOWN_MS - (Date.now() - last);
  return Math.max(0, left);
}

function writeCooldownNow() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SUBMIT_COOLDOWN_KEY, String(Date.now()));
}

export default function NextSeasonInterestForm({ season }: NextSeasonInterestFormProps) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [cooldownLeftMs, setCooldownLeftMs] = useState<number>(() => readCooldownLeft());

  const canSubmit = useMemo(() => !busy && cooldownLeftMs <= 0, [busy, cooldownLeftMs]);

  useEffect(() => {
    const t = setInterval(() => setCooldownLeftMs(readCooldownLeft()), 500);
    return () => clearInterval(t);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const left = readCooldownLeft();
    if (left > 0) {
      setCooldownLeftMs(left);
      setMsg(`Please wait ${Math.ceil(left / 1000)}s before trying again.`);
      return;
    }

    setBusy(true);
    setMsg(null);

    const response = await fetch("/api/next-season-interest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        full_name: fullName,
        website,
      }),
    });

    const json = (await response.json().catch(() => null)) as InterestResponse | null;
    setBusy(false);

    if (!response.ok || !json?.ok) {
      setMsg(json?.error ?? "Could not save your interest right now.");
      return;
    }

    writeCooldownNow();
    setCooldownLeftMs(readCooldownLeft());
    setEmail("");
    setFullName("");
    setWebsite("");
    setMsg(`Thanks. We will notify you when ${season} signup opens.`);
  }

  return (
    <form onSubmit={submit} className="ui-stack" style={{ marginTop: 12 }}>
      <label>
        <div className="ui-caption" style={{ marginBottom: 6 }}>
          Email
        </div>
        <input
          className="ui-input"
          style={{ width: "100%" }}
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label>
        <div className="ui-caption" style={{ marginBottom: 6 }}>
          Name (optional)
        </div>
        <input
          className="ui-input"
          style={{ width: "100%" }}
          type="text"
          placeholder="Your name"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          maxLength={120}
          required
        />
      </label>

      <div
        style={{
          position: "absolute",
          left: -10000,
          top: "auto",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
        <label htmlFor="website">Website</label>
        <input
          id="website"
          type="text"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <UiButton type="submit" disabled={!canSubmit} style={{ width: "100%", padding: 12 }}>
        {busy
          ? "Saving..."
          : cooldownLeftMs > 0
            ? `Notify me (wait ${Math.ceil(cooldownLeftMs / 1000)}s)`
            : `Notify me for ${season}`}
      </UiButton>

      {msg && <p className="ui-caption">{msg}</p>}
    </form>
  );
}
