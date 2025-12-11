import { NextResponse } from "next/server";

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
  bonusPercent: number;
  bonusValueUsd: number;
};

// Optional: external source (Google Apps Script, DB API, etc.)
const LEADERBOARD_API_URL = process.env.LEADERBOARD_API_URL;

/**
 * GET /api/leaderboard
 *
 * Must return: { rows: LeaderboardRow[] }
 */
export async function GET() {
  try {
    // If you don't have a backend yet, just return an empty leaderboard
    // so the UI shows "No buys yet" instead of an error.
    if (!LEADERBOARD_API_URL) {
      return NextResponse.json({ rows: [] }, { status: 200 });
    }

    const res = await fetch(LEADERBOARD_API_URL, {
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Leaderboard upstream error:", res.status, text);
      return NextResponse.json(
        { error: "Upstream leaderboard error" },
        { status: 500 }
      );
    }

    const data = await res.json();

    // We support either:
    //  - { rows: [...] }
    //  - [...] directly
    const rawRows: any[] = Array.isArray(data) ? data : data.rows ?? [];

    const rows: LeaderboardRow[] = rawRows.map((r) => {
      const wallet = String(r.wallet ?? "").trim();
      const totalBuys = Number(r.totalBuys ?? 0);
      const bonusPercent = Number(r.bonusPercent ?? 0);

      // Either use backend-provided bonusValueUsd, or compute it
      const baseUsd = totalBuys * 0.1; // $0.10 per buy
      const computedBonusValueUsd =
        baseUsd * (1 + (bonusPercent || 0) / 100);

      const bonusValueUsd =
        typeof r.bonusValueUsd === "number"
          ? r.bonusValueUsd
          : computedBonusValueUsd;

      return {
        wallet,
        totalBuys,
        bonusPercent,
        bonusValueUsd,
      };
    });

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err) {
    console.error("GET /api/leaderboard failed:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 }
    );
  }
}
