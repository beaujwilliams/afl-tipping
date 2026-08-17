import type { Metadata } from "next";
import { NEXT_SEASON } from "@/lib/season-config";
import SamplePageShell from "../SamplePageShell";
import {
  fixtureRadarCards,
  homeHeroStats,
  homeSideNotes,
} from "../sampleData";
import styles from "../page.module.css";

export const metadata: Metadata = {
  title: `Broadcast home sample | Complicated Tips`,
  description: "Broadcast-style home page sample for the next AFL tipping season.",
};

export default function NextSeasonSamplesHomePage() {
  return (
    <SamplePageShell
      activePage="home"
      eyebrow="Home page sample"
      title="A home page that feels like a round-night broadcast desk."
      description="This direction keeps the Broadcast Weekender tone, but borrows calmer layout structure from Clubhouse Premium and the urgency signals from Matchday Control Room."
      cardLabel="What this page is solving"
      cardTitle="Give members one strong opening story"
      cardCopy="The homepage should lead with tonight's biggest tension points, not a stack of equal-priority cards. That makes the product feel curated and more professional immediately."
      facts={homeHeroStats.map((item) => ({ label: item.label, value: item.value }))}
    >
      <section className={styles.metricStrip}>
        {homeHeroStats.map((item) => (
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
                <span className={styles.panelEyebrow}>Fixture radar</span>
                <h2>Three editorial game slots, chosen for story value instead of fixture order.</h2>
              </div>
              <p className={styles.panelIntro}>
                The radar should prioritize the most split tips, the top-six or top-eight pressure game,
                and a rank-one versus rank-two disagreement trigger when it exists.
              </p>
            </div>

            <div className={styles.radarGrid}>
              {fixtureRadarCards.map((card) => (
                <article key={card.slot} className={styles.radarCard}>
                  <div className={styles.radarHeader}>
                    <span className={styles.radarSlot}>{card.slot}</span>
                    <span className={styles.radarTime}>{card.time}</span>
                  </div>
                  <h3>{card.teams}</h3>
                  <p>{card.story}</p>

                  <div className={styles.splitLegend}>
                    <span>{card.leftLabel}</span>
                    <span>{card.rightLabel}</span>
                  </div>
                  <div className={styles.splitBar}>
                    <span style={{ width: `${card.leftPct}%` }} />
                  </div>
                  <div className={styles.radarNote}>{card.note}</div>
                </article>
              ))}
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHeaderCompact}>
              <div>
                <span className={styles.panelEyebrow}>Leader pulse</span>
                <h2>Turn the top of the comp into a live weekly story.</h2>
              </div>
            </div>

            <div className={styles.storyGrid}>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Race headline</span>
                <strong>Amy leads by 3.50 points, but she disagrees with Jordan on Blues vs Lions.</strong>
                <p>That single split becomes a natural home-page hook and gives the round a human storyline.</p>
              </article>
              <article className={styles.storyCard}>
                <span className={styles.storyLabel}>Action center</span>
                <strong>63 of 68 members have tipped. Five still need locking reminders before first bounce.</strong>
                <p>Keep this as a single line of operational urgency rather than separate admin-looking tiles.</p>
              </article>
            </div>
          </section>
        </div>

        <aside className={styles.sideStack}>
          {homeSideNotes.map((note) => (
            <section key={note.title} className={styles.sidePanel}>
              <span className={styles.panelEyebrow}>{note.title}</span>
              <p>{note.body}</p>
            </section>
          ))}

          <section className={styles.sidePanel}>
            <span className={styles.panelEyebrow}>Sample callouts</span>
            <ul className={styles.calloutList}>
              <li>Season {NEXT_SEASON} branding sits in the chrome instead of repeating in every card.</li>
              <li>The fixture radar gets the loudest treatment because it is the most ownable home-page module.</li>
              <li>Use the warm orange accent for urgency and spotlight moments, not every status label on the page.</li>
            </ul>
          </section>
        </aside>
      </div>
    </SamplePageShell>
  );
}
