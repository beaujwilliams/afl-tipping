import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { NEXT_SEASON } from "@/lib/season-config";
import { sampleFontClassName } from "./SamplePageShell";
import { sampleSuitePages } from "./sampleData";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: `Broadcast sample suite | Complicated Tips`,
  description: "Three broadcast-inspired sample pages for the next AFL tipping season.",
};

const suiteCards = [
  {
    href: "/next-season/samples/home",
    title: "Home page",
    label: "Opening story",
    body: "A broadcast-style landing page with fixture radar, leader pulse, and one cleaner action center.",
    bullets: [
      "Fixture radar prioritises the most split game, top-eight pressure game, and leaders-disagree trigger.",
      "The hero opens with round tension and lock urgency instead of stacked neutral cards.",
      "Right-rail notes keep commissioner, chat, and operational updates feeling intentional.",
    ],
  },
  {
    href: "/next-season/samples/leaderboard",
    title: "Leaderboard",
    label: "Race coverage",
    body: "A ladder page that starts like sports coverage, then settles into a more premium and readable board.",
    bullets: [
      "Top-of-ladder pressure gets the headline treatment before the table.",
      "Movement, gap to leader, and finals cut-line stay visible without visual clutter.",
      "Broadcast tone survives in the hero while the rows stay calm and scan-friendly.",
    ],
  },
  {
    href: "/next-season/samples/round",
    title: "Round tipping",
    label: "Match desk",
    body: "A tipping screen with strong match hierarchy, tip split context, and a more official save flow.",
    bullets: [
      "Games can be ordered by relevance and tension, not just fixture order.",
      "Each card explains why the game matters before the pick controls.",
      "The page blends control-room urgency with cleaner clubhouse-style spacing.",
    ],
  },
];

const designBlend = [
  "Broadcast Weekender gives the suite its energy, high-contrast hero moments, and sports-editorial identity.",
  "Clubhouse Premium tightens the information architecture so tables and action rows feel more trustworthy.",
  "Matchday Control Room contributes the live urgency: lock timers, leader splits, unread activity, and round tension.",
];

const conceptDirections = [
  {
    title: "Broadcast Weekender",
    label: "Recommended",
    image: "/design-samples/broadcast-weekender.png",
    alt: "Broadcast Weekender desktop concept for the Complicated Tips dashboard",
    body: "The strongest all-round direction: editorial enough to feel like a real competition brand, but still clear enough for weekly use.",
    fit: "Best for the home page, round stories, recaps, and the overall visual identity.",
  },
  {
    title: "Clubhouse Premium",
    label: "Calmest",
    image: "/design-samples/clubhouse-premium.png",
    alt: "Clubhouse Premium desktop concept for the Complicated Tips dashboard",
    body: "A mature, members-club interpretation with warmer materials, quieter data, and a more timeless season-to-season feel.",
    fit: "Best for tables, archives, rules, member profiles, and commissioner communication.",
  },
  {
    title: "Matchday Control Room",
    label: "Most live",
    image: "/design-samples/matchday-control-room.png",
    alt: "Matchday Control Room desktop concept for the Complicated Tips dashboard",
    body: "A sharper round-night treatment built around countdowns, completion, movement, crowd splits, and live activity.",
    fit: "Best for tipping, live rounds, alerts, and high-value status moments used with restraint.",
  },
];

export default function NextSeasonSamplesIndexPage() {
  return (
    <main className={`${styles.page} ${sampleFontClassName}`}>
      <div className={styles.overviewShell}>
        <section className={styles.overviewHero}>
          <div className={styles.overviewHeroCopy}>
            <span className={styles.pageEyebrow}>Broadcast sample suite</span>
            <h1>Three polished directions for season {NEXT_SEASON}.</h1>
            <p>
              Compare three credible visual identities, then open the live sample pages to see how the
              recommended blend translates into the home, leaderboard, and tipping experience.
            </p>

            <div className={styles.heroActionRow}>
              {sampleSuitePages
                .filter((page) => page.key !== "overview")
                .map((page) => (
                  <Link key={page.key} href={page.href} className={styles.primaryLink}>
                    Open {page.label}
                  </Link>
                ))}
            </div>
          </div>

          <aside className={styles.overviewHeroCard}>
            <div className={styles.mockCardEyebrow}>Best overall answer</div>
            <h2>Broadcast first. Product clarity underneath.</h2>
            <p>
              The goal is to make the site feel like a properly run competition brand, not a utility
              dashboard that happens to contain AFL data.
            </p>
            <ul className={styles.calloutList}>
              {designBlend.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </aside>
        </section>

        <section className={styles.conceptSection} aria-labelledby="concept-directions-title">
          <div className={styles.sectionHeading}>
            <span className={styles.pageEyebrow}>Visual concept boards</span>
            <h2 id="concept-directions-title">Three distinct ways the site could feel.</h2>
            <p>
              These boards establish the art direction. The coded samples below are the better guide
              for real content density, responsive behavior, and interaction.
            </p>
          </div>

          <div className={styles.conceptGrid}>
            {conceptDirections.map((concept) => (
              <article key={concept.title} className={styles.conceptCard}>
                <div className={styles.conceptImageFrame}>
                  <Image
                    src={concept.image}
                    alt={concept.alt}
                    width={1536}
                    height={1024}
                    sizes="(max-width: 840px) 100vw, (max-width: 1120px) 50vw, 33vw"
                    className={styles.conceptImage}
                  />
                  <span className={styles.conceptBadge}>{concept.label}</span>
                </div>
                <div className={styles.conceptCopy}>
                  <h3>{concept.title}</h3>
                  <p>{concept.body}</p>
                  <span>{concept.fit}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className={styles.sectionHeading}>
          <span className={styles.pageEyebrow}>Live coded samples</span>
          <h2>See the recommended blend on the three pages that matter most.</h2>
        </div>

        <section className={styles.overviewGrid}>
          {suiteCards.map((card) => (
            <article key={card.title} className={styles.overviewCard}>
              <span className={styles.cardLabel}>{card.label}</span>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
              <ul className={styles.calloutList}>
                {card.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
              <Link href={card.href} className={styles.secondaryLink}>
                Review sample
              </Link>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
