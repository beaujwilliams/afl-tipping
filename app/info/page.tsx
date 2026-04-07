import { UiCard, UiSectionHeader } from "@/components/ui";

export default function InfoPage() {
  return (
    <main className="ui-page" style={{ maxWidth: 800 }}>
      <UiSectionHeader
        title="How it works"
        subtitle={
          <span
            style={{
              fontSize: "clamp(1.05rem, 1.7vw, 1.25rem)",
              fontWeight: 700,
              color: "var(--text)",
              letterSpacing: "-0.01em",
            }}
          >
            Needlessly Complicated Tipping 2026
          </span>
        }
      />

      <section style={{ display: "grid", gap: 22, marginTop: 16, fontSize: 15, lineHeight: 1.6 }}>
        <UiCard tone="danger" style={{ padding: 22 }}>
          <p style={{ margin: 0, lineHeight: 1.55 }}>
            Season entry is $30. Please send payment to +61 423 190 713 when you join.
          </p>
        </UiCard>

        <div>
          <h2 style={{ marginBottom: 8 }}>1. Round locks at first bounce</h2>
          <p>All tips must be submitted before the first game of the round starts.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>2. Odds are locked before the round</h2>
          <p>Scoring odds are locked 36 hours before the round starts, and they stay fixed from that moment.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>3. Correct tips earn the listed odds</h2>
          <p>If your tip wins, you get that team’s odds as points.</p>

          <UiCard
            soft
            style={{
              marginTop: 12,
              fontSize: 14,
            }}
          >
            <div>• Tip Sydney at $1.29 → win → <b>1.29 points</b></div>
            <div>• Tip Hawthorn at $2.60 → win → <b>2.60 points</b></div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>Underdogs return more points.</div>
          </UiCard>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>4. Draws, wrong, or missing tips score 0</h2>
          <p>Only correct tips earn points.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>5. Tipping runs through the regular season and the finals</h2>
          <p>The competition continues through every finals match, including the Grand Final.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>6. Season winner and tie-breakers</h2>
          <p>
            The highest total points across the season wins. If two or more players are tied on
            total points, ranking is decided in this order:
          </p>
          <ol style={{ marginTop: 8, paddingLeft: 22 }}>
            <li>Higher accuracy percentage</li>
            <li>More correct tips</li>
          </ol>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>7. Prize money payout</h2>
          <p style={{ marginBottom: 8 }}>
            Total prize money for the 2026 season is $990. Distribution of this pool is:
          </p>
          <div>
            <div>1st $790</div>
            <div>2nd $150</div>
            <div>3rd $50.</div>
          </div>
          <p style={{ marginTop: 8 }}>
            All prizes will be paid within 3 days of the Grand Final being completed.
          </p>
        </div>
      </section>
    </main>
  );
}
