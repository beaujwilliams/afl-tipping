export default function InfoPage() {
  return (
    <main style={{ maxWidth: 800, margin: "40px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 24 }}>Needlessly Complicated Tipping 2026</h1>

      <section style={{ display: "grid", gap: 24, fontSize: 15, lineHeight: 1.6 }}>
        <div>
          <h2 style={{ marginBottom: 8 }}>1. Rounds lock at the first bounce</h2>
          <p>
            All tips must be submitted before the first match of the round starts.
          </p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>2. Points come from betting odds</h2>
          <p>
            If your tip is correct, you earn points equal to that team’s odds.
          </p>

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
            <div style={{ marginTop: 6, opacity: 0.85 }}>
              Underdogs earn more points.
            </div>
          </div>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>3. Odds are locked before the round</h2>
          <p>
            Odds are captured 36 hours before the round starts and used for scoring.
          </p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>4. Only correct tips score</h2>
          <p>
            Wrong tips or missing tips = 0 points.
          </p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>5. Season winner</h2>
          <p>
            The tipster with the most total points across the season wins.
          </p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>6. Allocation of prize money</h2>
          <p>
            Prize money distribution will be determined after Round 3 once total sign-ups are known.
            It may be winner-takes-all or split between 1st, 2nd, and 3rd place. Also app troubleshooting is required of all participants when directed by admin.
          </p>
        </div>

        <div>
          <h2 style={{ marginBottom: 8 }}>$30 entry fee</h2>
          <p>
            A $30 entry fee is required to participate.
          </p>
          <p>
            Payment must be made to <b>+61 423 190 713</b> before your tips will be counted.
          </p>
        </div>
      </section>
    </main>
  );
}