"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { useChatActivity } from "@/components/ChatActivityProvider";
import LogoutButton from "@/components/LogoutButton";

const BUILD_LABEL = process.env.NEXT_PUBLIC_BUILD_LABEL || "local dev";

type MenuKey = "tipping" | "info";
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
  unreadChat,
  unreadMentions,
}: {
  href: string;
  label: string;
  pathname: string;
  unreadChat: number;
  unreadMentions: number;
}) {
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  const isChat = href === "/chat";

  return (
    <Link href={href} style={pillStyles({ active })}>
      {label}
      {isChat && unreadChat > 0 && <CountBadge value={unreadChat} />}
      {isChat && unreadMentions > 0 && <CountBadge value={`@${unreadMentions}`} tone="warning" />}
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
      {typeof unread === "number" && unread > 0 && <CountBadge value={unread} />}
      <span style={{ opacity: 0.7 }}>{open ? "↑" : "↓"}</span>
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

export default function AppLayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [email, setEmail] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const navRef = useRef<HTMLDivElement | null>(null);
  const hoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { unreadChat, unreadMentions, unreadAnnouncements } = useChatActivity();

  useEffect(() => {
    let mounted = true;

    async function load() {
      const { data } = await supabaseBrowser.auth.getUser();
      if (!mounted) return;
      const user = data.user;
      setEmail(user?.email ?? null);

      if (!user?.id) {
        setIsAdmin(false);
        return;
      }

      const { data: adminMembership, error: adminErr } = await supabaseBrowser
        .from("memberships")
        .select("user_id")
        .eq("user_id", user.id)
        .in("role", ["owner", "admin"])
        .limit(1)
        .maybeSingle();

      if (!mounted) return;
      if (adminErr) {
        setIsAdmin(false);
        return;
      }

      setIsAdmin(!!adminMembership);
    }

    load();

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

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

  const profileHref = email ? "/profile" : "/login";
  const statsHref = email ? "/stats" : "/login";
  const profileLabel = "My Profile";

  const tippingActive =
    pathname.startsWith("/round/") || pathname.startsWith("/results/") || pathname.startsWith("/stats");
  const infoActive =
    pathname.startsWith("/announcements") || pathname.startsWith("/info") || pathname.startsWith("/admin");

  const tippingItems = useMemo<MenuItem[]>(
    () => [
      { href: "/round/2026", label: "Tip rounds" },
      { href: "/results/2026", label: "Results" },
      { href: statsHref, label: "My stats" },
    ],
    [statsHref]
  );

  const infoItems = useMemo<MenuItem[]>(() => {
    const items: MenuItem[] = [
      { href: "/announcements", label: "Announcements", badge: unreadAnnouncements },
      { href: "/info", label: "How it works" },
    ];
    if (isAdmin) {
      items.push({ href: "/admin", label: "Admin", tone: "danger" });
    }
    return items;
  }, [isAdmin, unreadAnnouncements]);

  const mobileOpenItems = openMenu === "tipping" ? tippingItems : infoItems;

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

                <TopLink
                  href="/leaderboard/2026"
                  label="Leaderboard"
                  pathname={pathname}
                  unreadChat={unreadChat}
                  unreadMentions={unreadMentions}
                />
                <TopLink
                  href="/chat"
                  label="Chat"
                  pathname={pathname}
                  unreadChat={unreadChat}
                  unreadMentions={unreadMentions}
                />
                <TopLink
                  href={profileHref}
                  label={profileLabel}
                  pathname={pathname}
                  unreadChat={unreadChat}
                  unreadMentions={unreadMentions}
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

              {!isMobile && email && (
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
                    {email}
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

                {openMenu === "info" && email && (
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

      <main style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>{children}</main>
    </>
  );
}
