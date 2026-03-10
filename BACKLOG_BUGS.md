# Bug Backlog

Last updated: 2026-03-10

## Active Bugs

| ID | Priority | Status | Bug | Impact | Area | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BUG-001 | P1 | Idea | Odds polling `useEffect` has a missing dependency (`loadOddsForMatchesLocked`) and lint warning | Risk of stale closure behavior in odds refresh path | Round page | `app/round/[season]/[round]/page.tsx` |
| BUG-005 | P2 | Idea | No automated checks for leaderboard sort default and tip-list grouping rules | Regressions can reappear without quick detection | Leaderboard/Round status | Add targeted tests with `BL-014` |

## Recently Fixed

| ID | Priority | Status | Bug | Fix summary | Area |
| --- | --- | --- | --- | --- | --- |
| BUG-002 | P1 | Done (2026-03-10) | Leaderboard sort/rank behavior confusion (lowest rank appearing at top when sorted by points) | Sorting behavior and rank presentation updated to avoid incorrect interpretation | Leaderboard |
| BUG-003 | P2 | Done (2026-03-10) | Selected tip showed a tick icon that covered odds | Removed tick icon and changed selected state to green outline only | Round tipping |
| BUG-004 | P1 | Done (2026-03-10) | Partial tipsters appeared in the tipped list | Tipped list now requires full round completion; others moved to not tipped list | Season rounds admin lists |

