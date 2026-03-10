import type { CSSProperties, ReactNode } from "react";

type UiSectionHeaderProps = {
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  right?: ReactNode;
  style?: CSSProperties;
};

export function UiSectionHeader({ kicker, title, subtitle, right, style }: UiSectionHeaderProps) {
  return (
    <div className="ui-page-header" style={style}>
      <div>
        {kicker ? <div className="ui-kicker">{kicker}</div> : null}
        <h2 className="ui-title--section" style={{ marginTop: kicker ? 4 : 0 }}>
          {title}
        </h2>
        {subtitle ? (
          <div className="ui-caption" style={{ marginTop: 6 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {right}
    </div>
  );
}
