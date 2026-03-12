import type { CSSProperties, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx";

type UiTableShellProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function UiTableShell({ children, className, style }: UiTableShellProps) {
  return (
    <div className={cx("ui-table-shell", className)} style={style}>
      {children}
    </div>
  );
}

type UiTableScrollProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

export function UiTableScroll({ children, className, style }: UiTableScrollProps) {
  return (
    <div className={cx("ui-table-scroll", className)} style={style}>
      {children}
    </div>
  );
}

type UiTableHeadCellProps = ThHTMLAttributes<HTMLTableCellElement>;

const baseHeadCellStyle: CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border)",
};

export function UiTableHeadCell({ className, style, children, ...rest }: UiTableHeadCellProps) {
  return (
    <th className={className} style={{ ...baseHeadCellStyle, ...style }} {...rest}>
      {children}
    </th>
  );
}

type UiTableCellProps = TdHTMLAttributes<HTMLTableCellElement>;

const baseCellStyle: CSSProperties = {
  padding: "12px",
  borderTop: "1px solid var(--border)",
};

export function UiTableCell({ className, style, children, ...rest }: UiTableCellProps) {
  return (
    <td className={className} style={{ ...baseCellStyle, ...style }} {...rest}>
      {children}
    </td>
  );
}
