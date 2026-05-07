import { UiBadge, UiCard, UiCardGrid } from "@/components/ui";

const CURRENT_SEASON = 2026;

type HomePageFallbackProps = {
  welcomeName: string;
};

export default function HomePageFallback({ welcomeName }: HomePageFallbackProps) {
  return (
    <main className="ui-page ui-page--content">
      <div className="ui-page-header">
        <h1 className="ui-title">{welcomeName ? `Welcome back, ${welcomeName}` : "Welcome back"}</h1>
        <UiBadge>Season {CURRENT_SEASON}</UiBadge>
      </div>

      <div className="dashboard-top-grid ui-mt-4 dashboard-top-grid--single">
        <UiCard soft className="dashboard-hero">
          <div className="ui-row-between">
            <div className="ui-kicker">Action center</div>
            <UiBadge tone="info">Loading</UiBadge>
          </div>

          <div className="dashboard-hero-title">
            <div className="ui-skeleton" style={{ height: 38, width: "66%" }} />
          </div>
          <div className="dashboard-hero-meta">
            <div className="ui-skeleton" style={{ height: 14, width: "48%" }} />
          </div>

          <UiCardGrid columns={3} className="dashboard-hero-stats">
            <UiCard className="dashboard-mini-card">
              <div className="ui-kicker">Your tips</div>
              <div className="ui-skeleton" style={{ height: 32, width: "52%", marginTop: 6 }} />
              <div className="ui-skeleton" style={{ height: 12, width: "74%", marginTop: 10 }} />
            </UiCard>
            <UiCard className="dashboard-mini-card">
              <div className="ui-kicker">First match</div>
              <div className="ui-skeleton" style={{ height: 32, width: "70%", marginTop: 6 }} />
              <div className="ui-skeleton" style={{ height: 12, width: "62%", marginTop: 10 }} />
            </UiCard>
            <UiCard className="dashboard-mini-card">
              <div className="ui-kicker">Status</div>
              <div className="ui-skeleton" style={{ height: 32, width: "48%", marginTop: 6 }} />
              <div className="ui-skeleton" style={{ height: 12, width: "68%", marginTop: 10 }} />
            </UiCard>
          </UiCardGrid>

          <div className="dashboard-today-picks">
            <div className="ui-kicker">Who you tipped today</div>
            <div className="dashboard-today-list">
              <div className="dashboard-today-item">
                <div className="dashboard-today-copy" style={{ display: "grid", gap: 8, width: "100%" }}>
                  <div className="ui-skeleton" style={{ height: 18, width: "45%" }} />
                  <div className="ui-skeleton" style={{ height: 12, width: "32%" }} />
                </div>
                <UiBadge tone="info">Loading</UiBadge>
              </div>
            </div>
          </div>

          <div className="dashboard-action-row">
            <div className="ui-skeleton" style={{ height: 38, width: 170 }} />
            <div className="ui-skeleton" style={{ height: 38, width: 150 }} />
          </div>
        </UiCard>
      </div>
    </main>
  );
}
