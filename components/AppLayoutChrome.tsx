"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useChatActivity } from "@/components/ChatActivityProvider";
import LogoutButton from "@/components/LogoutButton";
import { useToast } from "@/components/ToastProvider";
import { AFL_TEAMS } from "@/lib/afl-teams";
import { waitForSession } from "@/lib/session-client";
import { supabaseBrowser } from "@/lib/supabase-browser";

const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "local dev";
const TEAM_PROMPT_ONCE_KEY = "complicatedtips_team_prompt_seen_once_v1";

type MenuKey = "tipping" | "leaderboard" | "info";
type MenuItem = {
  href: string;
  label: string;
  tone?: "default" | "danger";
  badge?: number;
};

function CountBadge({
  value,
  tone = "danger",
}: {
  value: string | number;
  tone?: "danger" | "warning";
}) {
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 900,
        background: tone === "warning" ? "rgb(217, 119, 6)" : "rgb(239,68,68)",
        color: "white",
        borderRadius: 999,
        padding: "2px 7px",
        lineHeight: 1,
      }}
    >
      {value}
    </span>
  );
}

function pillStyles({
  active,
  danger = false,
}: {
  active: boolean;
  danger?: boolean;
}) {
  return {
    padding: "9px 12px",
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 700,
    textDecoration: "none",
    background: active
      ? danger
        ? "rgba(239, 68, 68, 0.12)"
        : "rgba(255,255,255,0.08)"
      : "transparent",
    color: danger ? "rgb(185, 28, 28)" : "inherit",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
    flex: "0 0 auto",
  } as const;
}

function TopLink({
  href,
  label,
  pathname,
  badges = [],
}: {
  href: string;
  label: string;
  pathname: string;
  badges?: Array<{ value: string | number; tone?: "danger" | "warning" }>;
}) {
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link href={href} style={pillStyles({ active })}>
      {label}
      {badges.map((badge, index) => (
        <span key={`${href}-badge-${index}`}>
          <CountBadge value={badge.value} tone={badge.tone ?? "danger"} />
        </span>
      ))}
    </Link>
  );
}

function DropdownTrigger({
  label,
  active,
  open,
  unread,
  onClick,
}: {
  label: string;
  active: boolean;
  open: boolean;
  unread?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      style={pillStyles({ active })}
    >
      {label}
      <span
        aria-hidden="true"
        style={{
          fontSize: 14,
          fontWeight: 600,
          lineHeight: 1,
          opacity: 0.78,
          transform: `translateY(${open ? "-0.5px" : "0"})`,
        }}
      >
        {open ? "↑" : "↓"}
      </span>
      {typeof unread === "number" && unread > 0 && <CountBadge value={unread} />}
    </button>
  );
}

function DesktopDropdown({
  items,
  pathname,
  onSelect,
  align = "start",
}: {
  items: MenuItem[];
  pathname: string;
  onSelect: () => void;
  align?: "start" | "end";
}) {
  return (
    <div
      style={{
        position: "absolute",
        top: "calc(100% + 2px)",
        left: align === "start" ? 0 : "auto",
        right: align === "end" ? 0 : "auto",
        minWidth: 220,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: 6,
        boxShadow: "0 10px 24px rgba(0,0,0,0.12)",
        zIndex: 60,
      }}
    >
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onSelect}
            style={{
              ...pillStyles({ active, danger: item.tone === "danger" }),
              width: "100%",
              justifyContent: "space-between",
              padding: "9px 10px",
              borderRadius: 10,
            }}
          >
            <span>{item.label}</span>
            {typeof item.badge === "number" && item.badge > 0 && <CountBadge value={item.badge} />}
          </Link>
        );
      })}
    </div>
  );
}

type AppLayoutChromeProps = {
  children: React.ReactNode;
  initialEmail?: string | null;
  initialIsAdmin?: boolean;
};

type TeamPromptProfileResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  profile?: {
    favorite_team: string | null;
  };
};

export default function AppLayoutChrome({
  children,
  initialEmail = null,
  initialIsAdmin = false,
}: AppLayoutChromeProps) {
  const toast = useToast();
  const pathname = usePathname() ?? "";
  const [isMobile, setIsMobile] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const [showTeamPrompt, setShowTeamPrompt] = useState(false);
  const [teamPromptChoice, setTeamPromptChoice] = useState("");
  const [teamPromptSaving, setTeamPromptSaving] = useState(false);
  const [teamPromptError, setTeamPromptError] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { unreadChat, unreadMentions, unreadAnnouncements, unreadLeaderboardInvites } =
    useChatActivity();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/reset-password") return;

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hashType = hashParams.get("type");
    const hashAccessToken = hashParams.get("access_token");
    const hashRefreshToken = hashParams.get("refresh_token");

    if (hashType === "recovery" && hashAccessToken && hashRefreshToken) {
      window.location.replace(`/reset-password#${hashParams.toString()}`);
    }
  }, [pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 860px)");
    const onChange = () => setIsMobile(media.matches);
    onChange();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverCloseTimerRef.current) {
        clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!openMenu) return;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!navRef.current) return;
      const target = event.target as Node | null;
      if (target && !navRef.current.contains(target)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [openMenu]);

  useEffect(() => {
    if (!initialEmail) return;
    if (pathname.startsWith("/profile")) return;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(TEAM_PROMPT_ONCE_KEY) === "1") return;

    let canceled = false;

    async function maybePromptForTeam() {
      try {
        const session = await waitForSession(2500, 180);
        const token = session?.access_token ?? null;
        if (!token || canceled) return;

        const res = await fetch("/api/profile", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json().catch(() => null)) as TeamPromptProfileResponse | null;
        if (!res.ok || canceled) return;

        const favoriteTeam = String(body?.profile?.favorite_team ?? "").trim();
        if (favoriteTeam) return;

        localStorage.setItem(TEAM_PROMPT_ONCE_KEY, "1");
        setTeamPromptChoice("");
        setTeamPromptError(null);
        setShowTeamPrompt(true);
      } catch {
        // Silent: if profile load fails, don't block navigation.
      }
    }

    maybePromptForTeam();
    return () => {
      canceled = true;
    };
  }, [initialEmail, pathname]);

  const profileHref = initialEmail ? "/profile" : "/login";
  const statsHref = initialEmail ? "/stats" : "/login";
  const profileLabel = "My Profile";

  const tippingActive =
    pathname.startsWith("/round/") || pathname.startsWith("/results/") || pathname.startsWith("/stats");
  const leaderboardActive = pathname.startsWith("/leaderboard/");
  const infoActive =
    pathname.startsWith("/announcements") ||
    pathname.startsWith("/info") ||
    pathname.startsWith("/audit") ||
    pathname.startsWith("/admin");

  const tippingItems = useMemo<MenuItem[]>(
    () => [
      { href: "/round/2026", label: "Submit your tips" },
      { href: "/results/2026", label: "Round Results" },
      { href: statsHref, label: "My stats" },
    ],
    [statsHref]
  );

  const infoItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { href: "/announcements", label: "Announcements", badge: unreadAnnouncements },
      { href: "/info", label: "How it works" },
      { href: "/audit", label: "Audit" },
    ];
    if (initialIsAdmin) {
      items.push({ href: "/admin", label: "Admin", tone: "danger" });
    }
    return items;
  }, [initialIsAdmin, unreadAnnouncements]);

  const leaderboardItems = useMemo<MenuItem[]>(
    () => [
      { href: "/leaderboard/2026", label: "Ladder", badge: unreadLeaderboardInvites },
      { href: "/leaderboard/2026/trend", label: "Trend" },
    ],
    [unreadLeaderboardInvites]
  );

  const mobileOpenItems =
    openMenu === "tipping"
      ? tippingItems
      : openMenu === "leaderboard"
      ? leaderboardItems
      : infoItems;
  const unreadAnnouncementsLabel = `${unreadAnnouncements} new announcement${
    unreadAnnouncements === 1 ? "" : "s"
  }`;

  function clearHoverCloseTimer() {
    if (!hoverCloseTimerRef.current) return;
    clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  }

  function onTriggerHoverOpen(key: MenuKey) {
    if (!isMobile) {
      clearHoverCloseTimer();
      setOpenMenu(key);
    }
  }

  function onTriggerHoverClose(key: MenuKey) {
    if (!isMobile) {
      clearHoverCloseTimer();
      hoverCloseTimerRef.current = setTimeout(() => {
        setOpenMenu((current) => (current === key ? null : current));
      }, 180);
    }
  }

  function onTriggerClick(key: MenuKey) {
    clearHoverCloseTimer();
    setOpenMenu((current) => (current === key ? null : key));
  }

  async function saveTeamFromPrompt() {
    if (!teamPromptChoice || teamPromptSaving) return;
    setTeamPromptSaving(true);
    setTeamPromptError(null);

    try {
      const { data } = await supabaseBrowser.auth.getSession();
      const token = data.session?.access_token ?? null;
      if (!token) {
        setTeamPromptError("Not authenticated. Please sign in again.");
        return;
      }

      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ favorite_team: teamPromptChoice }),
      });

      const body = (await res.json().catch(() => null)) as TeamPromptProfileResponse | null;
      if (!res.ok) {
        const details = body?.details ? ` (${body.details})` : "";
        setTeamPromptError(`${body?.error ?? "Could not save team selection."}${details}`);
        return;
      }

      setShowTeamPrompt(false);
      toast.success("Favourite team saved.");
    } catch {
      setTeamPromptError("Could not save team selection right now.");
    } finally {
      setTeamPromptSaving(false);
    }
  }

  return (
    <>
      <header
        style={{
          borderBottom: "1px solid var(--border)",
          padding: "18px 16px 14px",
        }}
      >
        <div
          style={{
            maxWidth: 1000,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <Link
            href="/"
            style={{
              fontWeight: 900,
              fontSize: 18,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            Needlessly Complicated AFL Tipping
          </Link>

          <div ref={navRef} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                  overflowX: isMobile ? "auto" : "visible",
                  paddingBottom: isMobile ? 2 : 0,
                }}
              >
                <div
                  style={{ position: "relative", flex: "0 0 auto" }}
                  onMouseEnter={() => onTriggerHoverOpen("tipping")}
                  onMouseLeave={() => onTriggerHoverClose("tipping")}
                >
                  <DropdownTrigger
                    label="Tipping"
                    active={tippingActive}
                    open={openMenu === "tipping"}
                    onClick={() => onTriggerClick("tipping")}
                  />
                  {!isMobile && openMenu === "tipping" && (
                    <DesktopDropdown
                      items={tippingItems}
                      pathname={pathname}
                      onSelect={() => setOpenMenu(null)}
                    />
                  )}
                </div>

                <div
                  style={{ position: "relative", flex: "0 0 auto" }}
                  onMouseEnter={() => onTriggerHoverOpen("leaderboard")}
                  onMouseLeave={() => onTriggerHoverClose("leaderboard")}
                >
                  <DropdownTrigger
                    label="Leaderboard"
                    active={leaderboardActive}
                    open={openMenu === "leaderboard"}
                    unread={unreadLeaderboardInvites}
                    onClick={() => onTriggerClick("leaderboard")}
                  />
                  {!isMobile && openMenu === "leaderboard" && (
                    <DesktopDropdown
                      items={leaderboardItems}
                      pathname={pathname}
                      onSelect={() => setOpenMenu(null)}
                    />
                  )}
                </div>
                <TopLink
                  href="/chat"
                  label="Chat"
                  pathname={pathname}
                  badges={[
                    ...(unreadChat > 0 ? [{ value: unreadChat }] : []),
                    ...(unreadMentions > 0
                      ? [{ value: `@${unreadMentions}`, tone: "warning" as const }]
                      : []),
                  ]}
                />
                <TopLink
                  href={profileHref}
                  label={profileLabel}
                  pathname={pathname}
                />

                <div
                  style={{ position: "relative", flex: "0 0 auto" }}
                  onMouseEnter={() => onTriggerHoverOpen("info")}
                  onMouseLeave={() => onTriggerHoverClose("info")}
                >
                  <DropdownTrigger
                    label="Info"
                    active={infoActive}
                    open={openMenu === "info"}
                    unread={unreadAnnouncements}
                    onClick={() => onTriggerClick("info")}
                  />
                  {!isMobile && openMenu === "info" && (
                    <DesktopDropdown
                      items={infoItems}
                      pathname={pathname}
                      onSelect={() => setOpenMenu(null)}
                      align="end"
                    />
                  )}
                </div>
              </div>

              {!isMobile && initialEmail && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 4,
                  }}
                >
                  <LogoutButton compact />
                  <div
                    style={{
                      fontSize: 12,
                      opacity: 0.6,
                      maxWidth: 220,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {initialEmail}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.45 }}>{BUILD_LABEL}</div>
                </div>
              )}
            </div>

            {isMobile && openMenu && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {mobileOpenItems.map((item) => {
                  const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpenMenu(null)}
                      style={{
                        ...pillStyles({ active, danger: item.tone === "danger" }),
                        border: "1px solid var(--border)",
                        background: active ? "rgba(255,255,255,0.09)" : "var(--card)",
                      }}
                    >
                      {item.label}
                      {typeof item.badge === "number" && item.badge > 0 && <CountBadge value={item.badge} />}
                    </Link>
                  );
                })}

                {openMenu === "info" && initialEmail && (
                  <>
                    <div style={{ flexBasis: "100%" }} />
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        border: "1px solid var(--border)",
                        borderRadius: 12,
                        padding: "8px 12px",
                        background: "var(--card)",
                      }}
                    >
                      <LogoutButton compact />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {isMobile && unreadAnnouncements > 0 && (
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 80,
            borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
            background: "var(--background)",
            padding: "8px 16px",
          }}
        >
          <div style={{ maxWidth: 1000, margin: "0 auto" }}>
            <Link
              href="/announcements"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                borderRadius: 999,
                border: "1px solid rgba(239, 68, 68, 0.45)",
                background: "rgba(239, 68, 68, 0.14)",
                color: "rgb(185, 28, 28)",
                fontWeight: 800,
                fontSize: 14,
                padding: "10px 12px",
              }}
            >
              <span>{unreadAnnouncementsLabel}</span>
              <span style={{ fontSize: 12, opacity: 0.9 }}>View</span>
            </Link>
          </div>
        </div>
      )}

      <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>{children}</main>

      {showTeamPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Select your AFL team"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 120,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--foreground)",
              padding: 16,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 24, letterSpacing: -0.2 }}>
              Add your AFL team
            </div>
            <div style={{ opacity: 0.82 }}>
              Helps with end-of-season insights. You can change this later in My Profile.
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>Team</div>
              <select
                className="ui-input"
                value={teamPromptChoice}
                onChange={(e) => setTeamPromptChoice(e.target.value)}
                disabled={teamPromptSaving}
              >
                <option value="">Select your team</option>
                {AFL_TEAMS.map((team) => (
                  <option key={team} value={team}>
                    {team}
                  </option>
                ))}
              </select>
            </label>

            {teamPromptError && (
              <div
                style={{
                  color: "rgb(185, 28, 28)",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {teamPromptError}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="ui-btn"
                onClick={() => setShowTeamPrompt(false)}
                disabled={teamPromptSaving}
              >
                Not now
              </button>
              <button
                type="button"
                className="ui-btn"
                onClick={saveTeamFromPrompt}
                disabled={!teamPromptChoice || teamPromptSaving}
                style={{
                  background: "var(--foreground)",
                  color: "var(--background)",
                  borderColor: "var(--foreground)",
                }}
              >
                {teamPromptSaving ? "Saving..." : "Save team"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
