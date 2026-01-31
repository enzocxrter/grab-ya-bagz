// scripts/export-buys-and-claims.ts

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// ----------------- CONFIG -----------------

// Linea RPC (read-only)
const LINEA_RPC_URL =
  process.env.LINEA_RPC_URL ?? "https://rpc.linea.build";

// TbagDailyFreeBuys contract
const TBAG_DAILY_BUYS_ADDRESS =
  process.env.TBAG_DAILY_BUYS_ADDRESS ??
  "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Approx deploy block to avoid scanning from 0
const FROM_BLOCK = Number(
  process.env.TBAG_DAILY_BUYS_FROM_BLOCK ?? "26505044"
);

// Chunk size so we don't hit the 10000-logs limit
const BLOCK_CHUNK = 30000;

// event Buy(address indexed user, uint64 userTotalBuys, uint32 buysInCurrentWindow);
const BUY_TOPIC = ethers.utils.id(
  "Buy(address,uint64,uint32)"
);

// Minimal ABI: only what we need
const TBAG_DAILY_BUYS_ABI = [
  "function totalBuys(address user) view returns (uint64)",
  "function claimableBuys(address user) view returns (uint256)",
];

// ----------------- TYPES -----------------

type Row = {
  wallet: string;
  totalBuys: number;
  totalClaims: number; // derived: totalBuys - claimableBuys
};

// ----------------- MAIN LOGIC -----------------

async function main() {
  console.log("Using RPC:", LINEA_RPC_URL);
  console.log("Contract:", TBAG_DAILY_BUYS_ADDRESS);
  console.log("From block:", FROM_BLOCK);

  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);

  const latestBlock = await provider.getBlockNumber();
  console.log("Latest block on Linea:", latestBlock);

  // 1) Find all wallets that ever emitted a Buy() event
  const buyers = new Set<string>();

  for (
    let fromBlock = FROM_BLOCK;
    fromBlock <= latestBlock;
    fromBlock += BLOCK_CHUNK + 1
  ) {
    const toBlock = Math.min(fromBlock + BLOCK_CHUNK, latestBlock);

    console.log(`Scanning Buy logs from ${fromBlock} to ${toBlock}...`);

    const logs = await provider.getLogs({
      address: TBAG_DAILY_BUYS_ADDRESS,
      fromBlock,
      toBlock,
      topics: [BUY_TOPIC],
    });

    console.log(`  Found ${logs.length} logs in this chunk`);

    for (const log of logs) {
      if (!log.topics || log.topics.length < 2) continue;
      const topic = log.topics[1];
      if (!topic || topic.length !== 66) continue;

      try {
        const addr = ethers.utils.getAddress("0x" + topic.slice(26));
        buyers.add(addr);
      } catch {
        // ignore malformed topic
      }
    }
  }

  const buyerList = Array.from(buyers);
  console.log(`\nTotal unique buyer wallets: ${buyerList.length}\n`);

  // 2) For each wallet, read totalBuys and claimableBuys,
  //    then derive totalClaims = totalBuys - claimableBuys
  const contract = new ethers.Contract(
    TBAG_DAILY_BUYS_ADDRESS,
    TBAG_DAILY_BUYS_ABI,
    provider
  );

  const rows: Row[] = [];

  // A tiny concurrency control so we don't nuke the RPC
  const CONCURRENCY = 10;
  let index = 0;

  async function worker(id: number) {
    while (true) {
      const i = index;
      if (i >= buyerList.length) break;
      index++;

      const wallet = buyerList[i];

      try {
        const [totalBuysBn, claimableBuysBn] = await Promise.all([
          contract.totalBuys(wallet),
          contract.claimableBuys(wallet),
        ]);

        const totalBuys = Number(totalBuysBn.toString());
        const claimableBuys = Number(claimableBuysBn.toString());
        const totalClaims = Math.max(0, totalBuys - claimableBuys);

        rows.push({
          wallet,
          totalBuys,
          totalClaims,
        });

        if ((rows.length % 100) === 0) {
          console.log(
            `Processed ${rows.length}/${buyerList.length} wallets...`
          );
        }
      } catch (err) {
        console.error(`Error reading data for ${wallet}:`, err);
        rows.push({
          wallet,
          totalBuys: 0,
          totalClaims: 0,
        });
      }
    }
  }

  console.log("Reading totalBuys & claimableBuys for each wallet...");

  const workers: Promise<void>[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }
  await Promise.all(workers);

  console.log("Finished reading wallet data. Total rows:", rows.length);

  // 3) Sort by totalBuys desc (optional, just nice)
  rows.sort((a, b) => b.totalBuys - a.totalBuys);

  // 4) Write CSV
  const header = "wallet,totalBuys,totalClaims\n";
  const lines = rows.map(
    (r) => `${r.wallet},${r.totalBuys},${r.totalClaims}`
  );
  const csv = header + lines.join("\n");

  const outPath = path.join(__dirname, "tbag-buys-and-claims.csv");
  fs.writeFileSync(outPath, csv);
  console.log("\nWrote CSV to:", outPath);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
