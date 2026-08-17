import Link from "next/link";
import { Bebas_Neue } from "next/font/google";
import type { ReactNode } from "react";
import { NEXT_SEASON } from "@/lib/season-config";
import { sampleSuitePages, type SamplePageKey } from "./sampleData";
import styles from "./page.module.css";

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bebas",
});

export const sampleFontClassName = bebas.variable;

type SampleFact = {
  label: string;
  value: string;
};

type SamplePageShellProps = {
  activePage: SamplePageKey;
  eyebrow: string;
  title: string;
  description: string;
  cardLabel: string;
  cardTitle: string;
  cardCopy: string;
  facts: SampleFact[];
  children: ReactNode;
};

export default function SamplePageShell({
  activePage,
  eyebrow,
  title,
  description,
  cardLabel,
  cardTitle,
  cardCopy,
  facts,
  children,
}: SamplePageShellProps) {
  return (
    <main className={`${styles.page} ${sampleFontClassName}`}>
      <div className={styles.shell}>
        <section className={styles.broadcastFrame}>
          <div className={styles.broadcastTopBar}>
            <Link href="/next-season/samples" className={styles.brandLink}>
              <span className={styles.brandMarkDot} />
              <span>Complicated Tips Broadcast Suite</span>
            </Link>

            <div className={styles.broadcastTopMeta}>
              <span className={styles.liveBadge}>Season {NEXT_SEASON} concept</span>
              <span className={styles.topMetaText}>Broadcast energy with calmer product structure</span>
            </div>
          </div>

          <div className={styles.sampleNav}>
            {sampleSuitePages.map((page) => {
              const active = page.key === activePage;
              return (
                <Link
                  key={page.key}
                  href={page.href}
                  className={`${styles.sampleNavLink}${active ? ` ${styles.sampleNavLinkActive}` : ""}`}
                >
                  {page.label}
                </Link>
              );
            })}
          </div>

          <div className={styles.shellHero}>
            <div className={styles.shellHeroCopy}>
              <span className={styles.pageEyebrow}>{eyebrow}</span>
              <h1>{title}</h1>
              <p>{description}</p>
            </div>

            <aside className={styles.shellHeroCard}>
              <div className={styles.mockCardEyebrow}>{cardLabel}</div>
              <h2>{cardTitle}</h2>
              <p>{cardCopy}</p>

              <div className={styles.factGrid}>
                {facts.map((fact) => (
                  <div key={fact.label} className={styles.factCard}>
                    <span>{fact.label}</span>
                    <strong>{fact.value}</strong>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </section>

        <div className={styles.sampleBody}>{children}</div>
      </div>
    </main>
  );
}
