// scripts/export-buys-and-claims.ts
//
// Usage (from project root):
//   npx ts-node scripts/export-buys-and-claims.ts
//
// Produces: tbag_wallet_stats.csv with:
//   wallet,total_buys,total_claimed_buys

import { ethers } from "ethers";
import fs from "node:fs";
import path from "node:path";

// --------- CONFIG ---------

// Linea RPC (you can override with an env var if you want)
const RPC_URL =
  process.env.RPC_URL || process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// TbagDailyFreeBuys contract
const CONTRACT_ADDRESS = "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Start block (same deploy block you’ve been using for the leaderboard)
const FROM_BLOCK = 26_505_044;

// Chunk size to avoid "more than 10000 results" RPC error
const BLOCK_CHUNK = 30_000;

// We only care about these two events:
const ABI = [
  "event Buy(address indexed user,uint64 userTotalBuys,uint32 buysInCurrentWindow)",
  "event Claim(address indexed user,uint256 buysClaimed,uint256 tokensPaid)",
];

const iface = new ethers.utils.Interface(ABI);

type WalletStats = {
  buys: number;           // count of Buy events (free buys recorded)
  claimedBuys: number;    // sum of buysClaimed from Claim events
};

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  const latestBlock = await provider.getBlockNumber();
  console.log(`Scanning blocks ${FROM_BLOCK} → ${latestBlock} on Linea…`);

  const stats = new Map<string, WalletStats>();

  const buyTopic = iface.getEventTopic("Buy");
  const claimTopic = iface.getEventTopic("Claim");

  for (
    let fromBlock = FROM_BLOCK;
    fromBlock <= latestBlock;
    fromBlock += BLOCK_CHUNK + 1
  ) {
    const toBlock = Math.min(fromBlock + BLOCK_CHUNK, latestBlock);
    console.log(`  Chunk ${fromBlock} – ${toBlock}`);

    // OR filter on topic[0] for Buy OR Claim
    const logs = await provider.getLogs({
      address: CONTRACT_ADDRESS,
      fromBlock,
      toBlock,
      topics: [[buyTopic, claimTopic]],
    });

    for (const log of logs) {
      let parsed;
      try {
        parsed = iface.parseLog(log);
      } catch {
        continue; // skip anything that doesn't match Buy/Claim
      }

      const user = ethers.utils.getAddress(parsed.args.user as string);
      const entry: WalletStats =
        stats.get(user) || { buys: 0, claimedBuys: 0 };

      if (parsed.name === "Buy") {
        // Count each Buy event as one free buy
        entry.buys += 1;
      } else if (parsed.name === "Claim") {
        // Sum how many buys were claimed in this Claim event
        const buysClaimedBn = parsed.args.buysClaimed as ethers.BigNumber;
        const buysClaimed = buysClaimedBn.toNumber();
        entry.claimedBuys += buysClaimed;
      }

      stats.set(user, entry);
    }
  }

  // Sort by total buys, descending
  const rows = Array.from(stats.entries()).sort(
    (a, b) => b[1].buys - a[1].buys
  );

  let csv = "wallet,total_buys,total_claimed_buys\n";
  for (const [wallet, { buys, claimedBuys }] of rows) {
    csv += `${wallet},${buys},${claimedBuys}\n`;
  }

  const outPath = path.join(process.cwd(), "tbag_wallet_stats.csv");
  fs.writeFileSync(outPath, csv, "utf8");

  console.log(`\nDone. Wrote ${rows.length} wallets to: ${outPath}`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
