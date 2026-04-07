import type { CSSProperties, HTMLAttributes } from "react";
import { cx } from "./cx";

type UiSkeletonProps = HTMLAttributes<HTMLDivElement> & {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
};

export function UiSkeleton({
  className,
  style,
  width = "100%",
  height = 14,
  radius,
  ...rest
}: UiSkeletonProps) {
  return (
    <div
      className={cx("ui-skeleton", className)}
      style={{
        width,
        height,
        borderRadius: radius ?? 10,
        ...style,
      }}
      aria-hidden="true"
      {...rest}
    />
  );
}
