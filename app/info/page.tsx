export default function InfoPage() {
  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 6 }}>How it works</h1>
      <div style={{ marginBottom: 22, opacity: 0.72 }}>Needlessly Complicated Tipping 2026</div>

      <section style={{ display: "grid", gap: 22, fontSize: 15, lineHeight: 1.6 }}>
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.35)",
          }}
        >
          <h2 style={{ marginBottom: 8 }}>Start here: payment required</h2>
          <p style={{ margin: 0 }}>
            Entry is <b>$30</b>. Pay <b>+61 423 190 713</b> before your tips will be counted.
          </p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>1. Round locks at first bounce</h2>
          <p>All tips must be submitted before the first game of the round starts.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>2. Correct tips score odds points</h2>
          <p>If your tip wins, you get that team’s odds as points.</p>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              borderRadius: 12,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: 14,
            }}
          >
            <div>• Tip Sydney at $1.29 → win → <b>1.29 points</b></div>
            <div>• Tip Hawthorn at $2.60 → win → <b>2.60 points</b></div>
            <div style={{ marginTop: 6, opacity: 0.85 }}>Underdogs return more points.</div>
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>3. Odds are locked before the round</h2>
          <p>Scoring odds are captured 36 hours before the round starts.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>4. Wrong or missing tips score 0</h2>
          <p>Only correct tips earn points.</p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>5. Season winner</h2>
          <p>The highest total points across the season wins.</p>
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
