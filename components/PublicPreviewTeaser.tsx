import { UiButtonLink, UiCard } from "@/components/ui";

type PublicPreviewTeaserProps = {
  title?: string;
  body?: string;
  buttonLabel?: string;
  href?: string;
};

export default function PublicPreviewTeaser({
  title = "See how Complicated Tips works",
  body = "View the rules, scoring, and an example ladder from 2026.",
  buttonLabel = "See how it works",
  href = "/howitworks",
}: PublicPreviewTeaserProps) {
  return (
    <UiCard soft className="ui-stack" style={{ marginTop: 14, gap: 10 }}>
      <div className="ui-kicker">What this is</div>

      <div>
        <h2 className="ui-title--section">{title}</h2>
        <p className="ui-caption" style={{ marginTop: 8, lineHeight: 1.55 }}>
          {body}
        </p>
      </div>

      <UiButtonLink href={href} prefetch={false} style={{ width: "100%", padding: 12 }}>
        {buttonLabel}
      </UiButtonLink>
    </UiCard>
  );
}
