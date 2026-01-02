import { NextResponse } from "next/server";
import { ethers } from "ethers";

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
};

// ----------------------------------------
// Config
// ----------------------------------------

// Same address as front-end
const TBAG_DAILY_BUYS_ADDRESS =
  process.env.NEXT_PUBLIC_TBAG_DAILY_BUYS_ADDRESS ??
  "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Linea RPC
const LINEA_RPC_URL =
  process.env.LINEA_RPC_URL ?? "https://rpc.linea.build";

// Starting block to avoid scanning from genesis
const LEADERBOARD_FROM_BLOCK = Number(
  process.env.LEADERBOARD_FROM_BLOCK ?? 26505044
);

// Optional max rows (front-end also slices)
const LEADERBOARD_MAX_ENTRIES = Number(
  process.env.LEADERBOARD_MAX_ENTRIES ?? 500
);

// Buy event signature: event Buy(address indexed user, uint64 userTotalBuys, uint32 buysInCurrentWindow);
const BUY_TOPIC = ethers.utils.id("Buy(address,uint64,uint32)");

// ----------------------------------------
// Simple in-memory cache (per serverless instance)
// ----------------------------------------
let cachedRows: LeaderboardRow[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// ----------------------------------------
// Helper: recursively fetch logs, splitting when RPC says >10000 results
// ----------------------------------------
async function fetchLogsRecursive(
  provider: any,
  fromBlock: number,
  toBlock: number
): Promise<any[]> {
  if (fromBlock > toBlock) return [];

  try {
    const logs = await provider.getLogs({
      address: TBAG_DAILY_BUYS_ADDRESS,
      fromBlock,
      toBlock,
      topics: [BUY_TOPIC],
    });
    return logs;
  } catch (err: any) {
    const code = err?.code ?? err?.error?.code;
    // Linea RPC: -32005 "query returned more than 10000 results"
    if (code === -32005 && fromBlock < toBlock) {
      const mid = Math.floor((fromBlock + toBlock) / 2);
      console.warn(
        `getLogs too large, splitting range ${fromBlock}–${toBlock} into ${fromBlock}–${mid} and ${
          mid + 1
        }–${toBlock}`
      );

      const [left, right] = await Promise.all([
        fetchLogsRecursive(provider, fromBlock, mid),
        fetchLogsRecursive(provider, mid + 1, toBlock),
      ]);

      return [...left, ...right];
    }

    console.error(
      `getLogs failed for range ${fromBlock}–${toBlock}:`,
      err?.message || err
    );
    throw err;
  }
}

// ----------------------------------------
// Core: read all Buy logs and build leaderboard
// ----------------------------------------
async function fetchLeaderboardFromChain(): Promise<LeaderboardRow[]> {
  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);
  const latestBlock = await provider.getBlockNumber();

  console.log(
    `Building leaderboard from chain ${TBAG_DAILY_BUYS_ADDRESS}, blocks ${LEADERBOARD_FROM_BLOCK}–${latestBlock}`
  );

  const logs = await fetchLogsRecursive(
    provider,
    LEADERBOARD_FROM_BLOCK,
    latestBlock
  );

  const counts = new Map<string, number>();

  for (const log of logs) {
    if (!log.topics || log.topics.length < 2) continue;

    const topic = log.topics[1];
    if (!topic || typeof topic !== "string" || topic.length !== 66) continue;

    try {
      const addr = ethers.utils.getAddress("0x" + topic.slice(26));
      counts.set(addr, (counts.get(addr) ?? 0) + 1);
    } catch {
      // ignore bad addresses
    }
  }

  const rows: LeaderboardRow[] = Array.from(counts.entries())
    .map(([wallet, totalBuys]) => ({
      wallet,
      totalBuys,
    }))
    .sort((a, b) => b.totalBuys - a.totalBuys)
    .slice(0, LEADERBOARD_MAX_ENTRIES);

  console.log(
    `Leaderboard built with ${rows.length} wallets (from ${counts.size} unique addresses)`
  );

  return rows;
}

// ----------------------------------------
// GET /api/leaderboard
// ----------------------------------------
export async function GET() {
  try {
    const now = Date.now();

    // Serve from cache if still fresh
    if (cachedRows && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json(
        { rows: cachedRows },
        {
          status: 200,
          headers: {
            "Cache-Control": "max-age=15, stale-while-revalidate=30",
          },
        }
      );
    }

    const rows = await fetchLeaderboardFromChain();
    cachedRows = rows;
    cachedAt = Date.now();

    return NextResponse.json(
      { rows },
      {
        status: 200,
        headers: {
          "Cache-Control": "max-age=15, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    console.error("GET /api/leaderboard failed:", err);

    // If we have an old cache, serve that with 200 so the UI still works
    if (cachedRows && cachedRows.length > 0) {
      return NextResponse.json(
        {
          error: "Failed to refresh leaderboard, serving cached data.",
          rows: cachedRows,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "max-age=15, stale-while-revalidate=30",
          },
        }
      );
    }

    // No cache yet – real failure
    return NextResponse.json(
      { error: "Failed to load leaderboard", rows: [] },
      { status: 500 }
    );
  }
}
