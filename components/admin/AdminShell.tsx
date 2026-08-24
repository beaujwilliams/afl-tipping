"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CURRENT_SEASON, NEXT_SEASON } from "@/lib/season-config";
import { cx } from "@/components/ui/cx";

type AdminNavItem = {
  href: string;
  label: string;
  detail: string;
  match?: string;
};

type AdminNavGroup = {
  label: string;
  items: AdminNavItem[];
};

const adminNavGroups: AdminNavGroup[] = [
  {
    label: "Today",
    items: [
      {
        href: "/admin",
        label: "Control room",
        detail: "Issues, status, and weekly actions",
        match: "/admin",
      },
    ],
  },
  {
    label: "Rounds & scoring",
    items: [
      {
        href: `/admin/scoring-sync?season=${CURRENT_SEASON}`,
        label: "Scoring log",
        detail: "Results sync and leaderboard refreshes",
        match: "/admin/scoring-sync",
      },
      {
        href: `/admin/automation-health?season=${CURRENT_SEASON}`,
        label: "Automation runs",
        detail: "Cron and scoring job health",
        match: "/admin/automation-health",
      },
      {
        href: "/admin/recaps",
        label: "Round recaps",
        detail: "Generate and review recap history",
        match: "/admin/recaps",
      },
    ],
  },
  {
    label: "Members & money",
    items: [
      {
        href: `/admin/roster/${CURRENT_SEASON}`,
        label: "Season roster",
        detail: "Live member roles and payment locks",
        match: "/admin/roster",
      },
      {
        href: "/admin/payments",
        label: "Payments",
        detail: "Record, match, and follow up",
        match: "/admin/payments",
      },
      {
        href: "/admin/onboarding",
        label: "Onboarding",
        detail: `Next season pipeline (${NEXT_SEASON})`,
        match: "/admin/onboarding",
      },
      {
        href: "/admin/interested-members",
        label: "Raw signups",
        detail: "Interest archive and exports",
        match: "/admin/interested-members",
      },
    ],
  },
  {
    label: "Comms",
    items: [
      {
        href: "/announcements",
        label: "Announcements",
        detail: "Member-facing posts",
        match: "/announcements",
      },
    ],
  },
  {
    label: "Settings & logs",
    items: [
      {
        href: "/admin/settings/people",
        label: "People settings",
        detail: "Champion and cross-season controls",
        match: "/admin/settings/people",
      },
      {
        href: `/admin/audit-log?season=${CURRENT_SEASON}`,
        label: "Audit log",
        detail: "Admin action history",
        match: "/admin/audit-log",
      },
      {
        href: "/admin#admin-recovery",
        label: "Rare recovery",
        detail: "Manual backfill and force tools",
        match: "#admin-recovery",
      },
    ],
  },
];

function isActive(pathname: string, item: AdminNavItem) {
  if (item.match === "/admin") return pathname === "/admin";
  if (!item.match || item.match.startsWith("#")) return false;
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const mobileNavItems = adminNavGroups.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.label }))
  );

  return (
    <div className="ui-admin-shell">
      <aside className="ui-admin-shell-sidebar" aria-label="Admin navigation">
        <div className="ui-admin-shell-header">
          <div className="ui-admin-shell-kicker">Admin</div>
          <div className="ui-admin-shell-title">Operations</div>
          <div className="ui-admin-shell-meta">Season {CURRENT_SEASON}</div>
        </div>

        <div className="ui-admin-mobile-links" aria-label="Admin shortcuts">
          {mobileNavItems.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={`mobile-${item.group}-${item.href}`}
                href={item.href}
                className={cx("ui-admin-mobile-link", active && "ui-admin-mobile-link--active")}
                aria-current={active ? "page" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <nav className="ui-admin-shell-nav">
          {adminNavGroups.map((group) => (
            <div key={group.label} className="ui-admin-shell-group">
              <div className="ui-admin-shell-group-label">{group.label}</div>
              <div className="ui-admin-shell-links">
                {group.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <Link
                      key={`${group.label}-${item.href}`}
                      href={item.href}
                      className={cx("ui-admin-shell-link", active && "ui-admin-shell-link--active")}
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="ui-admin-shell-link-label">{item.label}</span>
                      <span className="ui-admin-shell-link-detail">{item.detail}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      <div className="ui-admin-shell-content">{children}</div>
    </div>
  );
}
