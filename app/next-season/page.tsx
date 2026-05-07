import Link from "next/link";
import NextSeasonInterestForm from "@/components/NextSeasonInterestForm";
import { CURRENT_SEASON, NEXT_SEASON, SIGNUPS_OPEN } from "@/lib/season-config";

export default function NextSeasonPage() {
  return (
    <main className="ui-page" style={{ maxWidth: 460 }}>
      <h1 className="ui-title" style={{ fontSize: "clamp(2rem, 6vw, 2.4rem)" }}>
        Join next season
      </h1>

      <div className="ui-card ui-stack" style={{ marginTop: 16 }}>
        {SIGNUPS_OPEN ? (
          <>
            <p className="ui-caption">Signup is currently open for season {CURRENT_SEASON}.</p>
            <Link href="/signup" prefetch={false} className="ui-btn" style={{ width: "100%", padding: 12 }}>
              Create account
            </Link>
          </>
        ) : (
          <>
            <p className="ui-caption">
              Season {CURRENT_SEASON} is already in progress, so we have paused new account creation.
            </p>
            <p className="ui-caption">
              Leave your details and we will notify you when season {NEXT_SEASON} signup opens.
            </p>
            <NextSeasonInterestForm season={NEXT_SEASON} />
          </>
        )}
      </div>

      <Link href="/login" prefetch={false} className="ui-btn" style={{ width: "100%", padding: 12, marginTop: 12 }}>
        Back to login
      </Link>
    </main>
  );
}
