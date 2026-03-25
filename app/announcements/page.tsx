"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { UiBadge, UiCard } from "@/components/ui";

type AnnouncementRow = {
  id: string;
  competition_id: string | null;
  title: string;
  body: string;
  image_urls: string[];
  is_pinned: boolean;
  published_at_utc: string | null;
  created_at: string | null;
  created_by_display_name: string | null;
};

type AnnouncementsResponse = {
  ok?: boolean;
  admin?: boolean;
  rows?: AnnouncementRow[];
  error?: string;
  details?: string;
  hint?: string;
};

type CreateAnnouncementResponse = {
  ok?: boolean;
  row?: AnnouncementRow;
  error?: string;
  details?: string;
  hint?: string;
};

function fmtMelbourne(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function parseImageUrlsInput(input: string) {
  const unique = new Set<string>();
  for (const line of input.split("\n")) {
    const value = line.trim();
    if (!value) continue;
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
      unique.add(value);
    } catch {
      continue;
    }
  }
  return Array.from(unique).slice(0, 12);
}

export default function AnnouncementsPage() {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [msg, setMsg] = useState("Loading announcements...");
  const [token, setToken] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrlsInput, setImageUrlsInput] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [adminMsg, setAdminMsg] = useState("");

  const imageCount = useMemo(() => parseImageUrlsInput(imageUrlsInput).length, [imageUrlsInput]);

  async function load(nextToken?: string | null) {
    setMsg("Loading announcements...");
    const accessToken = nextToken ?? token;
    if (!accessToken) {
      setMsg("Not authenticated.");
      return;
    }

    const res = await fetch("/api/announcements", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const json = (await res.json().catch(() => null)) as AnnouncementsResponse | null;
    if (!res.ok || !json?.ok) {
      const detail = json?.details ? ` (${json.details})` : "";
      const hint = json?.hint ? ` ${json.hint}` : "";
      setMsg(`${json?.error ?? "Could not load announcements."}${detail}${hint}`);
      setRows([]);
      setIsAdmin(false);
      return;
    }

    setRows(Array.isArray(json.rows) ? json.rows : []);
    setIsAdmin(!!json.admin);
    setMsg("");
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabaseBrowser.auth.getSession();
      if (!alive) return;
      const accessToken = data.session?.access_token ?? null;
      if (!accessToken) {
        window.location.href = "/login";
        return;
      }
      setToken(accessToken);
      await load(accessToken);
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function publishAnnouncement() {
    if (!token || saving) return;
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    if (!cleanTitle || !cleanBody) {
      setAdminMsg("Title and post text are required.");
      return;
    }

    setSaving(true);
    setAdminMsg("");

    const res = await fetch("/api/admin/announcements", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: cleanTitle,
        body: cleanBody,
        image_urls: parseImageUrlsInput(imageUrlsInput),
        is_pinned: isPinned,
      }),
    });

    const json = (await res.json().catch(() => null)) as CreateAnnouncementResponse | null;
    if (!res.ok || !json?.ok) {
      const detail = json?.details ? ` (${json.details})` : "";
      const hint = json?.hint ? ` ${json.hint}` : "";
      setAdminMsg(`${json?.error ?? "Could not publish announcement."}${detail}${hint}`);
      setSaving(false);
      return;
    }

    setTitle("");
    setBody("");
    setImageUrlsInput("");
    setIsPinned(false);
    setAdminMsg("Announcement published.");
    await load(token);
    setSaving(false);
  }

  async function deleteAnnouncement(id: string) {
    if (!token || deletingId) return;
    const ok = window.confirm("Delete this announcement?");
    if (!ok) return;

    setDeletingId(id);
    setAdminMsg("");
    const res = await fetch(`/api/admin/announcements?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => null)) as
      | { ok?: boolean; error?: string; hint?: string }
      | null;
    if (!res.ok || !json?.ok) {
      const hint = json?.hint ? ` ${json.hint}` : "";
      setAdminMsg(`${json?.error ?? "Could not delete announcement."}${hint}`);
      setDeletingId(null);
      return;
    }

    setRows((prev) => prev.filter((row) => row.id !== id));
    setDeletingId(null);
  }

  return (
    <main className="ui-page ui-page--narrow">
      <div className="ui-page-header">
        <h1 className="ui-title">Announcements</h1>
        <UiBadge>Feature updates</UiBadge>
      </div>

      <UiCard soft style={{ marginTop: 14 }}>
        <div className="ui-caption">
          New features, changes, and notes. Screenshot links are shown inline for quick scan.
        </div>
      </UiCard>

      {isAdmin && (
        <UiCard soft style={{ marginTop: 14 }}>
          <div className="ui-title--section">Post announcement</div>
          <div className="ui-caption" style={{ marginTop: 6 }}>
            Publish updates to all members in this competition.
          </div>

          <div className="ui-stack" style={{ marginTop: 12 }}>
            <label className="ui-stack">
              <div className="ui-caption">Title</div>
              <input
                className="ui-input"
                style={{ width: "100%" }}
                maxLength={140}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short headline"
              />
            </label>

            <label className="ui-stack">
              <div className="ui-caption">Post text</div>
              <textarea
                className="ui-input"
                style={{ width: "100%", minHeight: 130, resize: "vertical" }}
                maxLength={12000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What changed and why it matters."
              />
            </label>

            <label className="ui-stack">
              <div className="ui-caption">Image URLs (one per line)</div>
              <textarea
                className="ui-input"
                style={{ width: "100%", minHeight: 96, resize: "vertical" }}
                value={imageUrlsInput}
                onChange={(event) => setImageUrlsInput(event.target.value)}
                placeholder="https://..."
              />
              <div className="ui-caption">{imageCount} valid image link(s)</div>
            </label>

            <label className="ui-row-wrap" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={isPinned}
                onChange={(event) => setIsPinned(event.target.checked)}
              />
              <span className="ui-caption">Pin to top</span>
            </label>

            <button
              type="button"
              className="ui-btn"
              style={{ width: "100%", padding: 12 }}
              disabled={saving}
              onClick={publishAnnouncement}
            >
              {saving ? "Publishing..." : "Publish announcement"}
            </button>
          </div>

          {adminMsg && (
            <div className="ui-caption" style={{ marginTop: 10 }}>
              {adminMsg}
            </div>
          )}
        </UiCard>
      )}

      {msg ? (
        <UiCard soft style={{ marginTop: 14 }}>
          <div className="ui-caption">{msg}</div>
        </UiCard>
      ) : rows.length === 0 ? (
        <UiCard soft style={{ marginTop: 14 }}>
          <div className="ui-caption">No announcements yet.</div>
        </UiCard>
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
          {rows.map((row) => {
            const publishedAt = fmtMelbourne(row.published_at_utc ?? row.created_at);
            return (
              <UiCard key={row.id} soft={row.is_pinned}>
                <div className="ui-row-between-start">
                  <div className="ui-stack" style={{ gap: 6 }}>
                    <div style={{ fontSize: 22, lineHeight: 1.2, fontWeight: 800 }}>{row.title}</div>
                    <div className="ui-caption">
                      {publishedAt}
                      {row.created_by_display_name ? ` - ${row.created_by_display_name}` : ""}
                    </div>
                  </div>
                  <div className="ui-row-wrap" style={{ gap: 8 }}>
                    {row.is_pinned && <UiBadge>Pinned</UiBadge>}
                    {isAdmin && (
                      <button
                        type="button"
                        className="ui-btn"
                        disabled={deletingId === row.id}
                        onClick={() => deleteAnnouncement(row.id)}
                      >
                        {deletingId === row.id ? "Deleting..." : "Delete"}
                      </button>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.55,
                    fontSize: 15,
                  }}
                >
                  {row.body}
                </div>

                {Array.isArray(row.image_urls) && row.image_urls.length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    }}
                  >
                    {row.image_urls.map((url, index) => (
                      <a
                        key={`${row.id}-image-${index}`}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "block" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`${row.title} image ${index + 1}`}
                          loading="lazy"
                          style={{
                            width: "100%",
                            display: "block",
                            borderRadius: 12,
                            border: "1px solid var(--border)",
                            background: "var(--card-soft)",
                          }}
                        />
                      </a>
                    ))}
                  </div>
                )}
              </UiCard>
            );
          })}
        </div>
      )}
    </main>
  );
}
