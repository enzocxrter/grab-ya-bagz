// scripts/export-buys-and-claims.ts
//
// Usage (from project root):
//   npx ts-node scripts/export-buys-and-claims.ts
//
// Outputs:
//   scripts/tbag-buys-and-claims.csv
//
// Columns:
//   wallet,totalBuys,totalClaims

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

// ---------------------------
// Config
// ---------------------------

// Linea RPC (use env if you have one, otherwise default public RPC)
const LINEA_RPC_URL =
  process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// TbagDailyFreeBuys contract (same as in your app)
const TBAG_DAILY_BUYS_ADDRESS =
  process.env.NEXT_PUBLIC_TBAG_DAILY_BUYS_ADDRESS ||
  "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Approx deploy block you used in the app for leaderboard
const FROM_BLOCK = 26505044;

// Chunk size to avoid "more than 10000 results" RPC errors
const BLOCK_CHUNK_SIZE = 30000;

// We only *need* the Buy event + view functions
const CONTRACT_ABI = [
  // Event signatures
  "event Buy(address indexed user, uint64 userTotalBuys, uint32 buysInCurrentWindow)",

  // Views
  "function totalBuys(address user) view returns (uint64)",
  "function claimableBuys(address user) view returns (uint256)"
];

// Topic0 for Buy()
const BUY_TOPIC = ethers.utils.id(
  "Buy(address,uint64,uint32)"
);

async function main() {
  console.log("RPC URL:", LINEA_RPC_URL);
  console.log("Contract:", TBAG_DAILY_BUYS_ADDRESS);
  console.log("Scanning from block:", FROM_BLOCK);

  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);
  const contract = new ethers.Contract(
    TBAG_DAILY_BUYS_ADDRESS,
    CONTRACT_ABI,
    provider
  );

  const latestBlock = await provider.getBlockNumber();
  console.log("Latest block:", latestBlock);

  // 1) Discover all wallets that ever emitted a Buy event
  const walletSet = new Set<string>();

  for (
    let fromBlock = FROM_BLOCK;
    fromBlock <= latestBlock;
    fromBlock += BLOCK_CHUNK_SIZE + 1
  ) {
    const toBlock = Math.min(
      fromBlock + BLOCK_CHUNK_SIZE,
      latestBlock
    );

    console.log(
      `Scanning logs ${fromBlock} -> ${toBlock}...`
    );

    const logs = await provider.getLogs({
      address: TBAG_DAILY_BUYS_ADDRESS,
      fromBlock,
      toBlock,
      topics: [BUY_TOPIC]
    });

    for (const log of logs) {
      if (!log.topics || log.topics.length < 2) continue;

      const topic1 = log.topics[1];
      if (!topic1 || topic1.length !== 66) continue;

      try {
        const addr = ethers.utils.getAddress(
          "0x" + topic1.slice(26)
        );
        walletSet.add(addr);
      } catch {
        // ignore malformed addresses
      }
    }

    console.log(
      `  Found wallets so far: ${walletSet.size}`
    );
  }

  const wallets = Array.from(walletSet);
  console.log(
    `Discovered ${wallets.length} unique wallets with Buy events.`
  );

  // 2) For each wallet, read totalBuys & claimableBuys from the contract
  //    Then derive: totalClaims = totalBuys - claimableBuys
  const results: {
    wallet: string;
    totalBuys: number;
    totalClaims: number;
  }[] = [];

  const CONCURRENCY = 10;
  let index = 0;

  async function worker(workerId: number) {
    while (true) {
      const i = index++;
      if (i >= wallets.length) break;

      const wallet = wallets[i];

      try {
        const [totalBuysBn, claimableBuysBn] = await Promise.all([
          contract.totalBuys(wallet),
          contract.claimableBuys(wallet)
        ]);

        const totalBuys = totalBuysBn.toNumber();
        const claimableBuys = claimableBuysBn.toNumber();
        const totalClaims = Math.max(
          0,
          totalBuys - claimableBuys
        );

        results.push({
          wallet,
          totalBuys,
          totalClaims
        });

        if (i % 50 === 0) {
          console.log(
            `Worker ${workerId}: processed ${i + 1}/${wallets.length}`
          );
        }
      } catch (err) {
        console.error(
          `Error reading data for wallet ${wallet}:`,
          err
        );
        // Still push something so we see they existed
        results.push({
          wallet,
          totalBuys: 0,
          totalClaims: 0
        });
      }
    }
  }

  console.log(
    `Fetching totalBuys & claimableBuys for each wallet with concurrency = ${CONCURRENCY}...`
  );

  await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      worker(i + 1)
    )
  );

  console.log("Finished fetching on-chain data.");

  // 3) Sort by totalBuys desc for nicer CSV
  results.sort(
    (a, b) => b.totalBuys - a.totalBuys
  );

  // 4) Write CSV
  const outPath = path.join(
    __dirname,
    "tbag-buys-and-claims.csv"
  );

  const header = "wallet,totalBuys,totalClaims\n";
  const lines = results.map((r) =>
    `${r.wallet},${r.totalBuys},${r.totalClaims}`
  );

  fs.writeFileSync(outPath, header + lines.join("\n"), {
    encoding: "utf8"
  });

  console.log(
    `Done. Wrote ${results.length} rows to: ${outPath}`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
