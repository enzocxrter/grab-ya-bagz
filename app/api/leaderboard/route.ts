import { NextResponse } from "next/server";
import { ethers } from "ethers";

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
};

const TBAG_DAILY_BUYS_ADDRESS =
  process.env.NEXT_PUBLIC_TBAG_DAILY_BUYS_ADDRESS ??
  "0xcA2538De53E21128B298a80d92f67b33605FEECC";

const LINEA_RPC_URL = process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// Deploy block for TbagDailyFreeBuys (decimal or hex).
// You set TBAG_DAILY_BUYS_DEPLOY_BLOCK in Vercel.
const DEPLOY_BLOCK_RAW = process.env.TBAG_DAILY_BUYS_DEPLOY_BLOCK || "0";
const DEPLOY_BLOCK = DEPLOY_BLOCK_RAW.startsWith("0x")
  ? parseInt(DEPLOY_BLOCK_RAW, 16)
  : parseInt(DEPLOY_BLOCK_RAW, 10);

const SAFE_DEPLOY_BLOCK: number = Number.isFinite(DEPLOY_BLOCK)
  ? DEPLOY_BLOCK
  : 0;

// event FreeBuyRecorded(address indexed user, uint64 newTotalBuys, uint64 buysInWindow, uint64 windowStart);
const FREE_BUY_TOPIC = ethers.utils.id(
  "FreeBuyRecorded(address,uint64,uint64,uint64)"
);

// ----- Simple in-memory cache (per serverless instance) -----
let cachedRows: LeaderboardRow[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// How many blocks to scan per chunk (to avoid 10k log limit)
const BLOCK_SPAN = 40_000;

// How many wallets to return in the leaderboard
const MAX_ROWS = 500;

async function fetchLeaderboardFromChain(): Promise<LeaderboardRow[]> {
  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);

  const latestBlock = await provider.getBlockNumber();

  const fromBlock = SAFE_DEPLOY_BLOCK;
  const toBlock = latestBlock;
  const counts = new Map<string, number>();

  for (let start = fromBlock; start <= toBlock; start += BLOCK_SPAN + 1) {
    const end = Math.min(start + BLOCK_SPAN, toBlock);

    const logs = await provider.getLogs({
      address: TBAG_DAILY_BUYS_ADDRESS,
      fromBlock: start,
      toBlock: end,
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
        // ignore invalid / non-address topics
      }
    }
  }

  const rows: LeaderboardRow[] = Array.from(counts.entries())
    .map(([wallet, totalBuys]) => ({ wallet, totalBuys }))
    .sort((a, b) => b.totalBuys - a.totalBuys)
    .slice(0, MAX_ROWS);

  return rows;
}

export async function GET() {
  try {
    const now = Date.now();

    // Serve cached leaderboard if still fresh
    if (cachedRows && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json({ rows: cachedRows }, { status: 200 });
    }

    // Otherwise recompute from chain
    const rows = await fetchLeaderboardFromChain();
    cachedRows = rows;
    cachedAt = now;

    return NextResponse.json({ rows }, { status: 200 });
  } catch (err) {
    console.error("GET /api/leaderboard failed:", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard", rows: [] },
      { status: 500 }
    );
  }
}
