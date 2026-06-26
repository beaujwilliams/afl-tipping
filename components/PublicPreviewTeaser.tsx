import { UiBadge, UiButtonLink, UiCard } from "@/components/ui";

type PublicPreviewTeaserProps = {
  title?: string;
  body?: string;
};

export default function PublicPreviewTeaser({
  title = "See a sample ladder before you join",
  body = "Browse an anonymised preview that shows exactly why someone can have fewer correct tips but still lead on points.",
}: PublicPreviewTeaserProps) {
  return (
    <UiCard soft className="ui-stack" style={{ marginTop: 14, gap: 10 }}>
      <div className="ui-row-wrap">
        <UiBadge tone="info">Sample preview</UiBadge>
        <UiBadge>Names hidden</UiBadge>
      </div>

      <div>
        <h2 className="ui-title--section">{title}</h2>
        <p className="ui-caption" style={{ marginTop: 8, lineHeight: 1.55 }}>
          {body}
        </p>
      </div>

      <UiButtonLink href="/info" prefetch={false} style={{ width: "100%", padding: 12 }}>
        View sample page
      </UiButtonLink>
    </UiCard>
  );
}
