This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Scheduled Pre-lock Reminders

This repo includes a GitHub Actions workflow at `.github/workflows/prelock-reminders.yml` that runs every 30 minutes and calls:

`/api/admin/send-prelock-reminders?season=2026&hours_before_lock=3&window_minutes=30`

The endpoint only sends to members who have not tipped, and deduplicates sends per user/round.

Required GitHub settings:

- Secret: `CRON_SECRET` (must match production `CRON_SECRET`)
- Optional repository variable: `SITE_URL` (defaults to `https://www.complicatedtips.com`)

## Scheduled Odds Snapshot

This repo includes a GitHub Actions workflow at `.github/workflows/snapshot-odds.yml` that runs every 10 minutes and calls:

`/api/admin/snapshot-odds-all-due?season=2026`

The endpoint only captures odds when a round is due (36 hours before round lock), so frequent polling is safe and keeps capture close to the exact due time.

Required GitHub settings:

- Secret: `CRON_SECRET` (must match production `CRON_SECRET`)
- Optional repository variable: `SITE_URL` (defaults to `https://www.complicatedtips.com`)

## Scheduled Scoring Sync + Leaderboard Refresh

This repo includes two GitHub Actions workflows:

- `.github/workflows/scoring-sync-15m.yml` runs every 15 minutes and calls:
  - `/api/admin/run-scoring-automation?season=2026&scope=active&job_kind=scoring_15m`
- `.github/workflows/scoring-sync-daily-full.yml` runs once daily and calls:
  - `/api/admin/run-scoring-automation?season=2026&scope=full&job_kind=scoring_daily_full`

Behavior:

- Active run scope targets locked rounds that still have unfinished matches.
- Full run scope is a safety pass across the season.
- Leaderboard recalc only runs when `sync-results.updated > 0`.

Required GitHub settings:

- Secret: `CRON_SECRET` (must match production `CRON_SECRET`)
- Optional repository variable: `SITE_URL` (defaults to `https://www.complicatedtips.com`)

## Signup Freeze + Next Season Interest

- `NEXT_PUBLIC_SIGNUPS_OPEN=false` pauses in-app account creation and sends people to `/next-season`.
- `NEXT_PUBLIC_CURRENT_SEASON=2026` controls current and next-season labels.
- Public interest entries are stored in `public.next_season_interest` and managed at `/admin/interested-members`.
- Run `db/migrations/20260326_next_season_interest.sql` before deploying.
- For a hard lock, also disable new signups in Supabase Auth while the season is in progress.
