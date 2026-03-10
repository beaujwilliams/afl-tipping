import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type BadgeTone = "neutral" | "open" | "locked";

type UiBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: BadgeTone;
};

function toneClass(tone: BadgeTone) {
  if (tone === "open") return "ui-badge--open";
  if (tone === "locked") return "ui-badge--locked";
  return "";
}

export function UiBadge({ children, className, tone = "neutral", ...rest }: UiBadgeProps) {
  return (
    <span className={cx("ui-badge", toneClass(tone), className)} {...rest}>
      {children}
    </span>
  );
}
