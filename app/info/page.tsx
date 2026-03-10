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

      <section style={{ display: "grid", gap: 22, fontSize: 15, lineHeight: 1.6 }}>
        <UiCard tone="danger">
          <h2 style={{ marginBottom: 8 }}>Start here: season entry</h2>
          <p style={{ margin: 0 }}>
            Season entry is <b>$30</b>. Please send payment to <b>+61 423 190 713</b> when you join.
          </p>
        </UiCard>

        <div>
          <h2 style={{ marginBottom: 8 }}>1. Round locks at first bounce</h2>
          <p>All tips must be submitted before the first game of the round starts.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>2. Odds are locked before the round</h2>
          <p>Scoring odds are captured 36 hours before the round starts.</p>
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
          <h2 style={{ marginBottom: 8 }}>4. Wrong or missing tips score 0</h2>
          <p>Only correct tips earn points.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>5. Season winner and tie-breakers</h2>
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
          <h2 style={{ marginBottom: 8 }}>6. Prize money split</h2>
          <p>
            Final prize distribution is set after Round 3 once total entries are confirmed. It may be
            winner-takes-all or split across 1st, 2nd, and 3rd.
          </p>
        </div>
      </section>
    </main>
  );
}
