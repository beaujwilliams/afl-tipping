import type { Metadata } from "next";
import SamplePageShell from "../SamplePageShell";
import {
  leaderboardInsights,
  leaderboardRows,
  leaderboardStoryCards,
} from "../sampleData";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: `Broadcast leaderboard sample | Complicated Tips`,
  description: "Broadcast-style leaderboard page sample for the next AFL tipping season.",
};

export default function NextSeasonSamplesLeaderboardPage() {
  return (
    <SamplePageShell
      activePage="leaderboard"
      eyebrow="Leaderboard sample"
      title="A leaderboard that opens like sports coverage, then settles into clean scanability."
      description="The visual direction stays loud in the hero, but the ladder itself becomes calmer and more premium so movement, cut lines, and gaps are easier to read."
      cardLabel="What this page is solving"
      cardTitle="Lead with the race, not the spreadsheet"
      cardCopy="People care about what changed this round: who moved, who is under pressure, and what result swings the table next. The table comes after that headline."
      facts={[
        { label: "Leader gap", value: "3.50 pts" },
        { label: "Finals line", value: "6th / 7th" },
        { label: "Biggest mover", value: "Marcus +4" },
      ]}
    >
      <section className={styles.storyStrip}>
        {leaderboardStoryCards.map((card) => (
          <article key={card.title} className={styles.storyStripCard}>
            <span>{card.title}</span>
            <strong>{card.value}</strong>
            <p>{card.body}</p>
          </article>
        ))}
      </section>

      <div className={styles.contentGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <span className={styles.panelEyebrow}>Ladder board</span>
              <h2>Broadcast-style rows, with the noise stripped out.</h2>
            </div>
            <p className={styles.panelIntro}>
              The first two rows get the most visual weight. Below that, spacing, movement, and gap to leader do the work.
            </p>
          </div>

          <div className={styles.tableShell}>
            <div className={styles.tableHeader}>
              <span>Rank</span>
              <span>Member</span>
              <span>Total</span>
              <span>Move</span>
              <span>Streak</span>
              <span>Gap</span>
              <span>Accuracy</span>
            </div>

            {leaderboardRows.map((row) => (
              <div key={row.rank} className={styles.tableRow}>
                <span className={styles.rankCell}>{row.rank}</span>
                <span className={styles.nameCell}>{row.name}</span>
                <span>{row.total}</span>
                <span className={styles.movementCell}>{row.movement}</span>
                <span>{row.streak}</span>
                <span>{row.gap}</span>
                <span>{row.accuracy}</span>
              </div>
            ))}
          </div>
        </section>

        <aside className={styles.sideStack}>
          <section className={styles.sidePanel}>
            <span className={styles.panelEyebrow}>Cut-line pressure</span>
            <p>
              Give sixth and seventh a dedicated side note so the leaderboard keeps mid-table players emotionally invested, not just the people in first place.
            </p>
          </section>

          <section className={styles.sidePanel}>
            <span className={styles.panelEyebrow}>Design notes</span>
            <ul className={styles.calloutList}>
              {leaderboardInsights.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </SamplePageShell>
  );
}
