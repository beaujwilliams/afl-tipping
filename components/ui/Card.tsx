import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

type CardTone = "default" | "success" | "warning" | "info" | "danger";

type UiCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  soft?: boolean;
  tone?: CardTone;
};

function toneClass(tone: CardTone) {
  if (tone === "success") return "ui-tone-success";
  if (tone === "warning") return "ui-tone-warning";
  if (tone === "info") return "ui-tone-info";
  if (tone === "danger") return "ui-tone-danger";
  return "";
}

export function UiCard({
  children,
  className,
  soft = false,
  tone = "default",
  style,
  ...rest
}: UiCardProps) {
  return (
    <div
      className={cx("ui-card", soft && "ui-card-soft", toneClass(tone), className)}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

type UiCardGridProps = {
  children: ReactNode;
  columns?: 1 | 2 | 3 | 4;
  className?: string;
  style?: CSSProperties;
};

export function UiCardGrid({ children, columns = 3, className, style }: UiCardGridProps) {
  const columnClass =
    columns === 2
      ? "ui-card-grid--2"
      : columns === 4
      ? "ui-card-grid--4"
      : columns === 3
      ? "ui-card-grid--3"
      : "";
  return (
    <div className={cx("ui-card-grid", columnClass, className)} style={style}>
      {children}
    </div>
  );
}
