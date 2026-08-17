import type { Metadata } from "next";
import SamplePageShell from "../SamplePageShell";
import {
  roundMatches,
  roundRadarNotes,
  roundSummaryStats,
} from "../sampleData";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: `Broadcast round tipping sample | Complicated Tips`,
  description: "Broadcast-style round tipping page sample for the next AFL tipping season.",
};

export default function NextSeasonSamplesRoundPage() {
  return (
    <SamplePageShell
      activePage="round"
      eyebrow="Round tipping sample"
      title="A tipping page that feels like a live match desk instead of a generic form."
      description="The list stays highly usable, but each game gets a clear sports-broadcast treatment with tip split context, odds confidence, and stronger save momentum."
      cardLabel="What this page is solving"
      cardTitle="Make every game feel intentionally framed"
      cardCopy="The user should understand why a game matters before they choose a side. That is where professionalism shows up: context first, interaction second."
      facts={roundSummaryStats.map((item) => ({ label: item.label, value: item.value }))}
    >
      <section className={styles.metricStrip}>
        {roundSummaryStats.map((item) => (
          <article key={item.label} className={styles.metricCard}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>

      <div className={styles.contentGrid}>
        <div className={styles.mainStack}>
          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <span className={styles.panelEyebrow}>Round 19 desk</span>
                <h2>Matches should be ordered by tension and relevance, not just kickoff time.</h2>
              </div>
              <p className={styles.panelIntro}>
                Your most split crowd game, top-eight pressure games, and leader-disagreement games deserve extra editorial emphasis before the rest of the fixture list.
              </p>
            </div>

            <div className={styles.matchList}>
              {roundMatches.map((match) => {
                const [homeTeam, awayTeam] = match.teams.split(" vs ");
                const pickedHome = match.pickedTeam === homeTeam;
                const pickedAway = match.pickedTeam === awayTeam;

                return (
                  <article key={`${match.time}-${match.teams}`} className={styles.matchCard}>
                    <div className={styles.matchHeader}>
                      <div>
                        <span className={styles.matchStory}>{match.tipStory}</span>
                        <h3>{match.teams}</h3>
                      </div>
                      <div className={styles.matchMeta}>
                        <span>{match.time}</span>
                        <span>{match.venue}</span>
                      </div>
                    </div>

                    <div className={styles.splitLegend}>
                      <span>{match.splitLeft}</span>
                      <span>{match.splitRight}</span>
                    </div>
                    <div className={styles.splitBar}>
                      <span style={{ width: `${match.splitPct}%` }} />
                    </div>

                    <div className={styles.oddsRow}>
                      <span>Home odds {match.homeOdds}</span>
                      <span>Away odds {match.awayOdds}</span>
                    </div>

                    <div className={styles.tipButtonRow}>
                      <button
                        type="button"
                        className={`${styles.tipButton}${pickedHome ? ` ${styles.tipButtonActive}` : ""}`}
                        aria-pressed={pickedHome}
                      >
                        {homeTeam}
                      </button>
                      <button
                        type="button"
                        className={`${styles.tipButton}${pickedAway ? ` ${styles.tipButtonActive}` : ""}`}
                        aria-pressed={pickedAway}
                      >
                        {awayTeam}
                      </button>
                    </div>

                    <p className={styles.matchNote}>{match.note}</p>
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <aside className={styles.sideStack}>
          {roundRadarNotes.map((note) => (
            <section key={note.title} className={styles.sidePanel}>
              <span className={styles.panelEyebrow}>{note.title}</span>
              <p>{note.body}</p>
            </section>
          ))}

          <section className={styles.sidePanel}>
            <span className={styles.panelEyebrow}>Suggested CTA layout</span>
            <div className={styles.ctaPreviewRow}>
              <button type="button" className={`${styles.tipButton} ${styles.tipButtonActive}`}>
                Save round
              </button>
              <button type="button" className={styles.tipButton}>
                Auto-pick
              </button>
            </div>
            <p>
              Keep the primary action high-contrast and close to progress. Secondary utilities can stay quieter in the same visual family.
            </p>
          </section>
        </aside>
      </div>
    </SamplePageShell>
  );
}
