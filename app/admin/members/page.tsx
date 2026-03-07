"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Member = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  joined_at: string;
};

type MemberRole = "owner" | "admin" | "member";

function normalizeRole(role: string | null | undefined): MemberRole {
  const r = String(role ?? "")
    .trim()
    .toLowerCase();
  if (r === "owner" || r === "admin" || r === "member") return r;
  return "member";
}

function fmtMelbourne(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default function AdminMembersPage() {
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string>("");

  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg("");

    const { data: s } = await supabaseBrowser.auth.getSession();
    const token = s.session?.access_token ?? null;
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setSessionToken(token);

    const res = await fetch("/api/admin/members", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(json?.error ? `${json.error}` : "Failed to load members");
      setLoading(false);
      return;
    }

    setMembers((json.members ?? []) as Member[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return members;

    return members.filter((m) => {
      const a = (m.display_name ?? "").toLowerCase();
      const b = (m.email ?? "").toLowerCase();
      const c = (m.user_id ?? "").toLowerCase();
      const d = normalizeRole(m.role).toLowerCase();
      return a.includes(needle) || b.includes(needle) || c.includes(needle) || d.includes(needle);
    });
  }, [members, q]);

  async function saveMember(user_id: string, display_name: string, role: MemberRole) {
    if (!sessionToken) return;
    setSavingId(user_id);
    setMsg("");

    const res = await fetch("/api/admin/members", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ user_id, display_name, role }),
    });

    const json = await res.json().catch(() => ({}));
    setSavingId(null);

    if (!res.ok) {
      setMsg(json?.error ? `${json.error}${json?.details ? `: ${json.details}` : ""}` : "Failed to save");
      return;
    }

    setMembers((prev) =>
      prev.map((m) =>
        m.user_id === user_id
          ? { ...m, display_name: display_name.trim() || null, role }
          : m
      )
    );
  }

  async function removeMember(user_id: string) {
    if (!sessionToken) return;
    const ok = confirm("Remove this person from the comp? They won’t be able to tip anymore.");
    if (!ok) return;

    setRemovingId(user_id);
    setMsg("");

    const res = await fetch("/api/admin/members", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ user_id }),
    });

    const json = await res.json().catch(() => ({}));
    setRemovingId(null);

    if (!res.ok) {
      setMsg(json?.error ? `${json.error}${json?.details ? `: ${json.details}` : ""}` : "Failed to remove");
      return;
    }

    setMembers((prev) => prev.filter((m) => m.user_id !== user_id));
  }

  return (
    <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Manage Members</h1>

        <button
          onClick={load}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #ccc", background: "white" }}
        >
          Refresh
        </button>
      </div>

      <div style={{ marginTop: 10, opacity: 0.75 }}>
        Total members: <b>{members.length}</b>
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / email / role / id…"
          style={{
            flex: 1,
            minWidth: 240,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #ccc",
          }}
        />
      </div>

      {msg && (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #f3c", borderRadius: 12 }}>
          {msg}
        </div>
      )}

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading…</p>
      ) : (
        <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 14, overflow: "hidden" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 16 }}>No matching members.</div>
          ) : (
            filtered.map((m, idx) => (
              <MemberRow
                key={m.user_id}
                m={m}
                idx={idx}
                onSave={saveMember}
                onRemove={removeMember}
                saving={savingId === m.user_id}
                removing={removingId === m.user_id}
              />
            ))
          )}
        </div>
      )}
    </main>
  );
}

function MemberRow({
  m,
  idx,
  onSave,
  onRemove,
  saving,
  removing,
}: {
  m: Member;
  idx: number;
  onSave: (user_id: string, display_name: string, role: MemberRole) => void;
  onRemove: (user_id: string) => void;
  saving: boolean;
  removing: boolean;
}) {
  const [name, setName] = useState(m.display_name ?? "");
  const [role, setRole] = useState<MemberRole>(normalizeRole(m.role));

  useEffect(() => {
    setName(m.display_name ?? "");
    setRole(normalizeRole(m.role));
  }, [m.display_name, m.role]);

  return (
    <div
      style={{
        padding: 14,
        borderTop: idx === 0 ? "none" : "1px solid #eee",
        display: "grid",
        gridTemplateColumns: "1.1fr 1.4fr 160px",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div>
        <div style={{ fontWeight: 900 }}>
          {m.display_name ? m.display_name : <span style={{ opacity: 0.6 }}>(no display name)</span>}
        </div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
          {m.email ?? `${m.user_id.slice(0, 8)}…`} • joined {fmtMelbourne(m.joined_at)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
          Role: <b>{normalizeRole(m.role)}</b>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Set display name…"
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 10,
            border: "1px solid #ccc",
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              fontWeight: 700,
            }}
          >
            <option value="owner">owner</option>
            <option value="admin">admin</option>
            <option value="member">member</option>
          </select>
          <button
            disabled={saving}
            onClick={() => onSave(m.user_id, name, role)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: saving ? "#f5f5f5" : "white",
              fontWeight: 800,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          disabled={removing}
          onClick={() => onRemove(m.user_id)}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #f3b",
            background: "white",
            fontWeight: 900,
          }}
        >
          {removing ? "Removing…" : "Remove"}
        </button>
      </div>
    </div>
  );
}
