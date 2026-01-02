import { NextResponse } from "next/server";
import { ethers } from "ethers";

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
};

// ---- Config ----
const TBAG_DAILY_BUYS_ADDRESS =
  process.env.TBAG_DAILY_BUYS_ADDRESS ??
  "0xcA2538De53E21128B298a80d92f67b33605FEECC";

const LINEA_RPC_URL = "https://rpc.linea.build";

// Max rows to return – keep in sync with your page.tsx if you change it there
const LEADERBOARD_MAX_ENTRIES = 500;

// Optional: deployment block of TbagDailyFreeBuys to avoid scanning from 0
const DEPLOY_BLOCK =
  Number(process.env.TBAG_DAILY_BUYS_DEPLOY_BLOCK ?? "0") || 0;

// event FreeBuyRecorded(address indexed user, uint64 newTotalBuys, uint64 buysInWindow, uint64 windowStart);
const FREE_BUY_TOPIC = ethers.utils.id(
  "FreeBuyRecorded(address,uint64,uint64,uint64)"
);

// ---- Simple in-memory cache (per lambda instance) ----
type LeaderboardCache = {
  rows: LeaderboardRow[];
  lastUpdated: number; // ms timestamp
};

const CACHE_TTL_MS = 60 * 1000; // 60s

// @ts-ignore – attach to globalThis to persist across requests on warm instances
if (!globalThis.__leaderboardCache) {
  // @ts-ignore
  globalThis.__leaderboardCache = { rows: [], lastUpdated: 0 } as LeaderboardCache;
}

// @ts-ignore
const leaderboardCache: LeaderboardCache = globalThis.__leaderboardCache;

/**
 * Fetch all FreeBuyRecorded logs in chunks, respecting the 10k limit,
 * starting from DEPLOY_BLOCK (or 0) up to latest.
 */
async function fetchLeaderboardFromChain(): Promise<LeaderboardRow[]> {
  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);

  const latestBlock = await provider.getBlockNumber();

  const fromBlock = DEPLOY_BLOCK > 0 ? DEPLOY_BLOCK : 0;
  let currentFrom = fromBlock;
  const step = 50_000; // initial chunk size; we’ll shrink if RPC complains

  const counts = new Map<string, number>();

  while (currentFrom <= latestBlock) {
    let currentTo = Math.min(currentFrom + step, latestBlock);

    try {
      const logs = await provider.getLogs({
        address: TBAG_DAILY_BUYS_ADDRESS,
        fromBlock: currentFrom,
        toBlock: currentTo,
        topics: [FREE_BUY_TOPIC],
      });

      for (const log of logs) {
        if (!log.topics || log.topics.length < 2) continue;
        const topic = log.topics[1];
        if (!topic || topic.length !== 66) continue;

        try {
          const addr = ethers.utils.getAddress("0x" + topic.slice(26));
          counts.set(addr, (counts.get(addr) ?? 0) + 1);
        } catch {
          // ignore malformed topics
        }
      }

      currentFrom = currentTo + 1;
    } catch (err: any) {
      const msg = String(
        err?.error?.message || err?.message || err.toString()
      ).toLowerCase();

      // If RPC says “>10000 results, use smaller range”, shrink our chunk
      if (
        err?.error?.code === -32005 ||
        msg.includes("returned more than 10000 results")
      ) {
        const suggestedFromHex = err?.error?.data?.from;
        const suggestedToHex = err?.error?.data?.to;

        if (suggestedFromHex && suggestedToHex) {
          const suggestedFrom = parseInt(suggestedFromHex, 16);
          const suggestedTo = parseInt(suggestedToHex, 16);

          // Narrow our range to what the node suggests
          currentFrom = suggestedFrom;
          currentTo = suggestedTo;
          continue;
        }

        // Fallback: halve the window if we don’t get hints
        const smallerStep = Math.max(5_000, Math.floor((currentTo - currentFrom + 1) / 2));
        if (smallerStep === currentTo - currentFrom + 1) {
          // already minimal, rethrow
          throw err;
        }

        // Retry with smaller window
        const mid = currentFrom + smallerStep - 1;
        currentTo = mid;
        continue;
      }

      // Other errors: rethrow
      throw err;
    }
  }

  const rows: LeaderboardRow[] = Array.from(counts.entries())
    .map(([wallet, totalBuys]) => ({ wallet, totalBuys }))
    .sort((a, b) => b.totalBuys - a.totalBuys)
    .slice(0, LEADERBOARD_MAX_ENTRIES);

  return rows;
}

/**
 * GET /api/leaderboard
 *
 * Returns: { rows: LeaderboardRow[] }
 */
export async function GET() {
  try {
    const now = Date.now();

    // Serve from cache if fresh enough
    if (
      leaderboardCache.rows.length > 0 &&
      now - leaderboardCache.lastUpdated < CACHE_TTL_MS
    ) {
      return NextResponse.json({ rows: leaderboardCache.rows }, { status: 200 });
    }

    const rows = await fetchLeaderboardFromChain();

    leaderboardCache.rows = rows;
    leaderboardCache.lastUpdated = now;

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err) {
    console.error("GET /api/leaderboard failed:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard", rows: [] },
      { status: 500 }
    );
  }
}
