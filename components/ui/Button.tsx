import Link from "next/link";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { cx } from "./cx";

type ButtonTone = "default" | "activeSuccess" | "activeDanger" | "dangerSoft";

function toneClass(tone: ButtonTone) {
  if (tone === "activeSuccess") return "ui-btn--active-success";
  if (tone === "activeDanger") return "ui-btn--active-danger";
  if (tone === "dangerSoft") return "ui-btn--danger-soft";
  return "";
}

type UiButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  pill?: boolean;
  tone?: ButtonTone;
};

export function UiButton({ children, className, pill = false, tone = "default", ...rest }: UiButtonProps) {
  return (
    <button
      className={cx("ui-btn", pill && "ui-btn--pill", toneClass(tone), className)}
      {...rest}
    >
      {children}
    </button>
  );
}

type UiButtonLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  pill?: boolean;
  tone?: ButtonTone;
  prefetch?: boolean;
};

export function UiButtonLink({
  href,
  children,
  className,
  style,
  pill = false,
  tone = "default",
  prefetch,
}: UiButtonLinkProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cx("ui-btn", pill && "ui-btn--pill", toneClass(tone), className)}
      style={style}
    >
      {children}
    </Link>
  );
}
