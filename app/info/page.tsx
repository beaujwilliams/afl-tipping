import { UiBadge, UiButtonLink, UiCard, UiCardGrid, UiSectionHeader } from "@/components/ui";
import { CURRENT_SEASON, NEXT_SEASON, SIGNUPS_OPEN } from "@/lib/season-config";
import styles from "./page.module.css";

const SAMPLE_LEADERBOARD = [
  {
    rank: 1,
    name: "Harbour Hounds",
    blurb: "Climbed three spots after two big underdog hits.",
    correctTips: 96,
    accuracy: "64.4%",
    totalPoints: "156.42",
    roundPoints: "+9.14",
    movement: "+3",
  },
  {
    rank: 2,
    name: "Boundary Riders",
    blurb: "More winners overall, but less value in the same round.",
    correctTips: 99,
    accuracy: "66.0%",
    totalPoints: "155.88",
    roundPoints: "+8.11",
    movement: "-1",
  },
  {
    rank: 3,
    name: "Pocket Press",
    blurb: "Steady scorer who rarely misses favourites.",
    correctTips: 94,
    accuracy: "62.7%",
    totalPoints: "153.01",
    roundPoints: "+7.44",
    movement: "-1",
  },
  {
    rank: 4,
    name: "Outer Wing Club",
    blurb: "Lower accuracy, still close thanks to earlier value rounds.",
    correctTips: 90,
    accuracy: "60.0%",
    totalPoints: "151.63",
    roundPoints: "+6.92",
    movement: "+1",
  },
  {
    rank: 5,
    name: "Scarlet Sherrins",
    blurb: "One rough week away from another jump into the top three.",
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
    summary: "Hit 7 of 9 winners, but most were short-priced favourites.",
    correctTips: "7/9",
    roundPoints: "8.11",
    notablePicks: [
      { title: "Cats at $1.27", detail: "Safe favourite", value: "+1.27" },
      { title: "Blues at $1.42", detail: "Favourite got the job done", value: "+1.42" },
      { title: "Lions at $1.56", detail: "Another short price", value: "+1.56" },
    ],
  },
  {
    name: "Harbour Hounds",
    badgeTone: "success" as const,
    badgeText: "Fewer winners, more value",
    summary: "Finished 6 of 9, but landed the round's biggest scoring swings.",
    correctTips: "6/9",
    roundPoints: "9.14",
    notablePicks: [
      { title: "Dockers at $2.55", detail: "Upset win that changed the ladder", value: "+2.55" },
      { title: "Saints at $3.20", detail: "Biggest hit of the round", value: "+3.20" },
      { title: "Dogs at $1.74", detail: "Useful favourite on top", value: "+1.74" },
    ],
  },
] as const;

const SCORE_CASES = [
  {
    badgeTone: "success" as const,
    badgeText: "Favourite",
    title: "Tip a short-priced winner",
    body: "You still score, just not as much. Good for staying in touch, not always enough to jump the field.",
    outcome: "+1.28 pts",
    outcomeClassName: styles.scoreOutcomeGood,
  },
  {
    badgeTone: "warning" as const,
    badgeText: "Value hit",
    title: "Tip the underdog and be right",
    body: "This is where the comp gets fun. One brave correct pick can be worth two favourites.",
    outcome: "+2.60 pts",
    outcomeClassName: styles.scoreOutcomeGood,
  },
  {
    badgeTone: "danger" as const,
    badgeText: "Miss",
    title: "Tip wrong, or do not tip",
    body: "Wrong tip, missed tip, or a draw all score zero. You still need accuracy over the full season.",
    outcome: "0 pts",
    outcomeClassName: styles.scoreOutcomeZero,
  },
] as const;

function movementClass(value: string) {
  if (value.startsWith("+")) return styles.movementUp;
  if (value.startsWith("-")) return styles.movementDown;
  return styles.movementFlat;
}

export default function InfoPage() {
  const primaryHref = SIGNUPS_OPEN ? "/signup" : "/next-season";
  const primaryLabel = SIGNUPS_OPEN ? "Create account" : `Join ${NEXT_SEASON}`;

  return (
    <main className={`ui-page ${styles.page}`}>
      <UiCard className={styles.heroCard}>
        <div className={styles.heroGlow} aria-hidden="true" />

        <div className={styles.heroLayout}>
          <div className={styles.heroCopy}>
            <div className="ui-row-wrap">
              <UiBadge tone="info">Sample preview</UiBadge>
              <UiBadge>Names hidden</UiBadge>
              <UiBadge tone="warning">Odds-based scoring</UiBadge>
            </div>

            <h1 className={styles.heroTitle}>A ladder where 6 correct tips can beat 7.</h1>
            <p className={styles.heroBody}>
              This comp rewards picking winners and picking the right winners. Short favourites keep
              you steady, underdogs create real separation, and the ladder can swing all weekend.
            </p>

            <div className={styles.heroActions}>
              <UiButtonLink href={primaryHref} prefetch={false}>
                {primaryLabel}
              </UiButtonLink>
              <UiButtonLink href="/login" prefetch={false}>
                Log in
              </UiButtonLink>
            </div>

            <p className={styles.heroPrivacy}>
              Every name and score below is illustrative only. The point is to show the shape of the
              comp, not expose real members.
            </p>
          </div>

          <div className={styles.heroAside}>
            <UiCard soft className={styles.asideCard}>
              <div className="ui-kicker">Why the ladder moved</div>
              <div className={styles.asideHeadline}>
                Harbour Hounds jumped from 4th to 1st with fewer winning tips.
              </div>
              <p className={styles.asideMeta}>
                Two value hits at $2.55 and $3.20 outweighed one extra favourite from the previous leader.
              </p>

              <div className={styles.swingList}>
                <div className={styles.swingRow}>
                  <div className={styles.swingRank}>1</div>
                  <div>
                    <div className={styles.swingName}>Harbour Hounds</div>
                    <div className={styles.swingNote}>6/9 winners, big underdog return</div>
                  </div>
                  <div className={styles.swingPoints}>9.14 pts</div>
                </div>

                <div className={styles.swingRow}>
                  <div className={styles.swingRank}>2</div>
                  <div>
                    <div className={styles.swingName}>Boundary Riders</div>
                    <div className={styles.swingNote}>7/9 winners, mostly short favourites</div>
                  </div>
                  <div className={styles.swingPoints}>8.11 pts</div>
                </div>
              </div>
            </UiCard>
          </div>
        </div>
      </UiCard>

      <UiCardGrid columns={3}>
        <UiCard className={styles.summaryCard}>
          <div className="ui-kicker">What makes it different</div>
          <div className={styles.summaryValue}>Points beat raw tip count</div>
          <p className={styles.summaryMeta}>
            The ladder is ordered by total points earned from winning odds, not just how many games you tipped correctly.
          </p>
        </UiCard>

        <UiCard className={styles.summaryCard}>
          <div className="ui-kicker">Why it stays fair</div>
          <div className={styles.summaryValue}>Odds freeze 36 hours early</div>
          <p className={styles.summaryMeta}>
            Everyone scores against the same locked prices, so late market movement does not distort the round.
          </p>
        </UiCard>

        <UiCard className={styles.summaryCard}>
          <div className="ui-kicker">What still matters</div>
          <div className={styles.summaryValue}>Accuracy decides ties</div>
          <p className={styles.summaryMeta}>
            If total points are tied, ranking falls back to higher accuracy percentage, then more correct tips.
          </p>
        </UiCard>
      </UiCardGrid>

      <section className={styles.sectionStack}>
        <UiSectionHeader
          kicker="Preview"
          title="Sample ladder"
          subtitle={`Illustrative data shaped like a live ${CURRENT_SEASON} season leaderboard.`}
          right={<UiBadge tone="info">Anonymous example</UiBadge>}
        />

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
            Boundary Riders has more correct tips than Harbour Hounds, but Harbour still leads because
            this comp ranks by points earned from correct odds, not raw tip count alone.
          </p>
        </UiCard>
      </section>

      <section className={styles.sectionStack}>
        <UiSectionHeader
          kicker="Round Story"
          title="Same round, different result"
          subtitle="This is the comparison most new visitors need to see."
        />

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

        <UiCard tone="warning" className={styles.explainerCard}>
          <UiBadge tone="warning">What sells the format</UiBadge>
          <p className={styles.explainerText}>
            Harbour Hounds only found six winners, but two of them were genuine price plays. Boundary Riders
            found seven winners, mostly at short odds, so they still lost the round on points. That tension is
            the whole hook: you want favourites for stability, but you also need the courage to back value.
          </p>
        </UiCard>
      </section>

      <section className={styles.sectionStack}>
        <UiSectionHeader
          kicker="Scoring"
          title="How scoring works in one glance"
          subtitle="Simple once you see one round play out."
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
            Tips lock at the first bounce of the round. Odds lock 36 hours earlier and stay fixed.
            Wrong tips, missed tips, and draws score zero. The comp runs through the regular season and finals.
          </p>
        </UiCard>
      </section>

      <UiCard className={styles.ctaCard}>
        <div className="ui-kicker">Ready to play</div>
        <div className={styles.ctaTitle}>The best preview page is one that makes the rules feel obvious.</div>
        <p className={styles.ctaBody}>
          For a closed season, this kind of page does the job well: it shows the ladder, explains the scoring
          tension, keeps member names private, and gives visitors a reason to register interest instead of bouncing.
        </p>

        <div className={styles.ctaActions}>
          <UiButtonLink href={primaryHref} prefetch={false}>
            {primaryLabel}
          </UiButtonLink>
          <UiButtonLink href="/login" prefetch={false}>
            Back to login
          </UiButtonLink>
        </div>
      </UiCard>
    </main>
  );
}
