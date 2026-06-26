import { UiBadge, UiCard, UiCardGrid, UiSectionHeader } from "@/components/ui";
import { CURRENT_SEASON } from "@/lib/season-config";
import styles from "@/app/info/page.module.css";

const SAMPLE_LEADERBOARD = [
  {
    rank: 1,
    name: "Harbour Hounds",
    blurb: "Big underdog round.",
    correctTips: 96,
    accuracy: "64.4%",
    totalPoints: "156.42",
    roundPoints: "+9.14",
    movement: "+3",
  },
  {
    rank: 2,
    name: "Boundary Riders",
    blurb: "More winners, less value.",
    correctTips: 99,
    accuracy: "66.0%",
    totalPoints: "155.88",
    roundPoints: "+8.11",
    movement: "-1",
  },
  {
    rank: 3,
    name: "Pocket Press",
    blurb: "Heavy on favourites.",
    correctTips: 94,
    accuracy: "62.7%",
    totalPoints: "153.01",
    roundPoints: "+7.44",
    movement: "-1",
  },
  {
    rank: 4,
    name: "Outer Wing Club",
    blurb: "Still close on points.",
    correctTips: 90,
    accuracy: "60.0%",
    totalPoints: "151.63",
    roundPoints: "+6.92",
    movement: "+1",
  },
  {
    rank: 5,
    name: "Scarlet Sherrins",
    blurb: "Still in the mix.",
    correctTips: 97,
    accuracy: "64.7%",
    totalPoints: "150.74",
    roundPoints: "+5.88",
    movement: "0",
  },
] as const;

const ROUND_SHOWDOWN = [
  {
    name: "Boundary Riders",
    badgeTone: "info" as const,
    badgeText: "More correct tips",
    summary: "7 winners, mostly favourites.",
    correctTips: "7/9",
    roundPoints: "8.11",
    notablePicks: [
      { title: "Cats at 1.27", detail: "Short favourite", value: "+1.27" },
      { title: "Blues at 1.42", detail: "Another favourite", value: "+1.42" },
      { title: "Lions at 1.56", detail: "Short price", value: "+1.56" },
    ],
  },
  {
    name: "Harbour Hounds",
    badgeTone: "success" as const,
    badgeText: "Fewer winners, more value",
    summary: "6 winners, better odds.",
    correctTips: "6/9",
    roundPoints: "9.14",
    notablePicks: [
      { title: "Dockers at 2.55", detail: "Big upset", value: "+2.55" },
      { title: "Saints at 3.20", detail: "Best hit", value: "+3.20" },
      { title: "Dogs at 1.74", detail: "Short favourite", value: "+1.74" },
    ],
  },
] as const;

const SCORE_CASES = [
  {
    badgeTone: "success" as const,
    badgeText: "Favourite",
    title: "Short favourite wins",
    body: "You score, but not much.",
    outcome: "+1.28 pts",
    outcomeClassName: styles.scoreOutcomeGood,
  },
  {
    badgeTone: "warning" as const,
    badgeText: "Value hit",
    title: "Underdog wins",
    body: "One good value pick can change a round.",
    outcome: "+2.60 pts",
    outcomeClassName: styles.scoreOutcomeGood,
  },
  {
    badgeTone: "danger" as const,
    badgeText: "Miss",
    title: "Wrong or missed tip",
    body: "Wrong, missed, or draw = zero.",
    outcome: "0 pts",
    outcomeClassName: styles.scoreOutcomeZero,
  },
] as const;

function movementClass(value: string) {
  if (value.startsWith("+")) return styles.movementUp;
  if (value.startsWith("-")) return styles.movementDown;
  return styles.movementFlat;
}

export default function HowItWorksPage() {
  return (
    <main className={`ui-page ${styles.page}`}>
      <UiCard className={styles.heroCard}>
        <div className={styles.heroGlow} aria-hidden="true" />

        <div className={styles.heroLayout}>
          <div className={styles.heroCopy}>
            <h1 className={styles.heroTitle}>A tipping comp where 6 tips can beat 7.</h1>
          </div>

          <div className={styles.heroAside}>
            <UiCard soft className={styles.asideCard}>
              <div className="ui-kicker">How scoring works</div>
              <div className={styles.asideHeadline}>Correct tips earn that team&apos;s odds as points.</div>
              <p className={styles.asideMeta}>
                Odds are pulled before the round and locked 36 hours before first bounce. Tip a winner
                and you get those odds as points. Tip wrong, miss, or land on a draw and you get zero.
              </p>
            </UiCard>
          </div>
        </div>
      </UiCard>

      <section className={styles.sectionStack}>
        <UiSectionHeader title="Same round, different result" />

        <div className={styles.compareGrid}>
          {ROUND_SHOWDOWN.map((entry) => (
            <UiCard key={entry.name} className={styles.compareCard}>
              <div className={styles.compareHeader}>
                <div>
                  <div className={styles.compareName}>{entry.name}</div>
                  <p className={styles.compareSub}>{entry.summary}</p>
                </div>
                <UiBadge tone={entry.badgeTone}>{entry.badgeText}</UiBadge>
              </div>

              <div className={styles.compareStats}>
                <div className={styles.compareStat}>
                  <div className={styles.compareStatLabel}>Correct tips</div>
                  <div className={styles.compareStatValue}>{entry.correctTips}</div>
                </div>
                <div className={styles.compareStat}>
                  <div className={styles.compareStatLabel}>Round points</div>
                  <div className={styles.compareStatValue}>{entry.roundPoints}</div>
                </div>
              </div>

              <div className={styles.pickList}>
                {entry.notablePicks.map((pick) => (
                  <div key={pick.title} className={styles.pickItem}>
                    <div>
                      <div className={styles.pickLabel}>{pick.title}</div>
                      <div className={styles.pickMeta}>{pick.detail}</div>
                    </div>
                    <div
                      className={`${styles.pickValue} ${pick.value.startsWith("+") ? styles.valueHit : ""}`}
                    >
                      {pick.value}
                    </div>
                  </div>
                ))}
              </div>
            </UiCard>
          ))}
        </div>
      </section>

      <section className={styles.sectionStack}>
        <UiSectionHeader title={`Example Ladder from ${CURRENT_SEASON}`} />

        <UiCard className={styles.sectionCard}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Entry</th>
                  <th>Correct tips</th>
                  <th>Accuracy</th>
                  <th>Total points</th>
                  <th>Round</th>
                  <th>Move</th>
                </tr>
              </thead>
              <tbody>
                {SAMPLE_LEADERBOARD.map((row) => (
                  <tr key={row.rank} className={row.rank === 1 ? styles.leaderRow : undefined}>
                    <td className={styles.rankCell}>{row.rank}</td>
                    <td>
                      <div className={styles.leaderCell}>
                        <span className={styles.alias}>{row.name}</span>
                        <span className={styles.aliasNote}>{row.blurb}</span>
                      </div>
                    </td>
                    <td className={styles.metricStrong}>{row.correctTips}</td>
                    <td>{row.accuracy}</td>
                    <td className={styles.metricStrong}>{row.totalPoints}</td>
                    <td className={styles.metricStrong}>{row.roundPoints}</td>
                    <td className={movementClass(row.movement)}>
                      {row.movement === "0" ? "No change" : row.movement}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.mobileLadderList}>
            {SAMPLE_LEADERBOARD.map((row) => (
              <div key={`${row.rank}-${row.name}-mobile`} className={styles.mobileLadderCard}>
                <div className={styles.mobileLadderHeader}>
                  <div className="ui-row-wrap" style={{ alignItems: "flex-start" }}>
                    <div className={styles.mobileLadderRank}>{row.rank}</div>
                    <div className={styles.leaderCell}>
                      <span className={styles.alias}>{row.name}</span>
                      <span className={styles.aliasNote}>{row.blurb}</span>
                    </div>
                  </div>
                  <UiBadge tone="info">{row.roundPoints}</UiBadge>
                </div>

                <div className={styles.mobileLadderMetrics}>
                  <div className={styles.mobileMetricCard}>
                    <div className={styles.mobileMetricLabel}>Total points</div>
                    <div className={styles.mobileMetricValue}>{row.totalPoints}</div>
                  </div>
                  <div className={styles.mobileMetricCard}>
                    <div className={styles.mobileMetricLabel}>Correct tips</div>
                    <div className={styles.mobileMetricValue}>{row.correctTips}</div>
                  </div>
                  <div className={styles.mobileMetricCard}>
                    <div className={styles.mobileMetricLabel}>Accuracy</div>
                    <div className={styles.mobileMetricValue}>{row.accuracy}</div>
                  </div>
                  <div className={styles.mobileMetricCard}>
                    <div className={styles.mobileMetricLabel}>Movement</div>
                    <div className={`${styles.mobileMetricValue} ${movementClass(row.movement)}`}>
                      {row.movement === "0" ? "No change" : row.movement}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="ui-caption" style={{ marginTop: 14, lineHeight: 1.6 }}>
            More winners does not always mean more points.
          </p>
        </UiCard>
      </section>

      <section className={styles.sectionStack}>
        <UiSectionHeader
          kicker="Scoring"
          title="How points work"
          subtitle="Three simple outcomes."
        />

        <UiCardGrid columns={3}>
          {SCORE_CASES.map((item) => (
            <UiCard key={item.title} className={styles.scoringCard}>
              <UiBadge tone={item.badgeTone}>{item.badgeText}</UiBadge>
              <div className={styles.scoreCaseTitle}>{item.title}</div>
              <p className={styles.scoreCaseBody}>{item.body}</p>
              <div className={`${styles.scoreOutcome} ${item.outcomeClassName}`}>{item.outcome}</div>
            </UiCard>
          ))}
        </UiCardGrid>

        <UiCard soft className={styles.rulesNote}>
          <p className="ui-caption" style={{ lineHeight: 1.65 }}>
            Tips lock at first bounce. Odds lock 36 hours earlier. Wrong, missed, or draw = zero.
          </p>
        </UiCard>
      </section>
    </main>
  );
}
