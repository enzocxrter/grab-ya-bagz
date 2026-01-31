import { ethers } from "ethers";
import * as fs from "fs";

// ------------------------------
// CONFIG – EDIT THESE
// ------------------------------

// Your TbagDailyFreeBuys contract on Linea
const CONTRACT_ADDRESS = "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Linea RPC (can override with env var)
const LINEA_RPC_URL =
  process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// Approximate deploy block (you used this before)
const DEPLOY_BLOCK = 26_505_044;

// Chunk size to avoid "more than 10000 results" RPC errors
const BLOCK_CHUNK = 30_000;

// ---- EVENTS ----
// Buy event (we already know this from the frontend)
const BUY_EVENT =
  "event Buy(address indexed user, uint64 userTotalBuys, uint32 buysInCurrentWindow)";

/**
 * ⚠️ IMPORTANT ABOUT CLAIMS
 *
 * This script *assumes* there is a claim event. If your contract does NOT emit
 * an event on claim, we cannot count "totalClaims" using only logs.
 *
 * 1) If you DO have a claim event, edit CLAIM_EVENT and the event name "ClaimAll"
 *    below to match exactly what’s in your Solidity.
 * 2) If you DON'T have a claim event, set HAS_CLAIM_EVENT = false and the
 *    script will only export totalBuys (claims will be 0).
 */

// Toggle this depending on whether your contract emits a claim event
const HAS_CLAIM_EVENT = true; // set to false if you don't have a claim event

// Example claim event ABI – UPDATE to match your contract if needed
const CLAIM_EVENT =
  "event ClaimAll(address indexed user, uint256 buysClaimed, uint256 tokensPaid)";

// ------------------------------
// TYPES
// ------------------------------
type WalletStats = {
  buys: number;
  claims: number;
};

// ------------------------------
// SCRIPT
// ------------------------------

async function main() {
  console.log("Starting export of wallet stats...");

  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);

  const eventAbis = [BUY_EVENT];
  if (HAS_CLAIM_EVENT) {
    eventAbis.push(CLAIM_EVENT);
  }

  const iface = new ethers.utils.Interface(eventAbis);

  const buyTopic = iface.getEventTopic("Buy");
  const claimTopic = HAS_CLAIM_EVENT
    ? iface.getEventTopic("ClaimAll") // change "ClaimAll" if your event name differs
    : null;

  const latestBlock = await provider.getBlockNumber();
  console.log(
    `Scanning from block ${DEPLOY_BLOCK} to ${latestBlock} in chunks of ${BLOCK_CHUNK}...`
  );

  const stats = new Map<string, WalletStats>();

  let fromBlock = DEPLOY_BLOCK;
  while (fromBlock <= latestBlock) {
    const toBlock = Math.min(fromBlock + BLOCK_CHUNK, latestBlock);
    console.log(`  → Chunk ${fromBlock} - ${toBlock}`);

    // --- BUY EVENTS ---
    try {
      const buyLogs = await provider.getLogs({
        address: CONTRACT_ADDRESS,
        fromBlock,
        toBlock,
        topics: [buyTopic],
      });

      for (const log of buyLogs) {
        const parsed = iface.parseLog(log);
        const user: string = parsed.args.user;
        const prev = stats.get(user) || { buys: 0, claims: 0 };
        // Each Buy event = 1 "buy"
        prev.buys += 1;
        stats.set(user, prev);
      }
    } catch (err) {
      console.error(`Error loading Buy logs in ${fromBlock}-${toBlock}:`, err);
    }

    // --- CLAIM EVENTS (if available) ---
    if (HAS_CLAIM_EVENT && claimTopic) {
      try {
        const claimLogs = await provider.getLogs({
          address: CONTRACT_ADDRESS,
          fromBlock,
          toBlock,
          topics: [claimTopic],
        });

        for (const log of claimLogs) {
          const parsed = iface.parseLog(log);
          const user: string = parsed.args.user;

          // Option A (current): count how many claim txs the wallet made
          const prev = stats.get(user) || { buys: 0, claims: 0 };
          prev.claims += 1;
          stats.set(user, prev);

          /**
           * Option B: if you instead want "total buysClaimed", you can do:
           *
           *   const buysClaimed: ethers.BigNumber = parsed.args.buysClaimed;
           *   prev.claims += buysClaimed.toNumber();
           *
           * and treat "claims" as "total buysClaimed" instead of "number of claim txs".
           */
        }
      } catch (err) {
        console.error(
          `Error loading Claim logs in ${fromBlock}-${toBlock}:`,
          err
        );
      }
    }

    fromBlock = toBlock + 1;
  }

  console.log(`Finished scanning. Unique wallets: ${stats.size}`);

  // ------------------------------
  // Write CSV
  // ------------------------------
  const lines: string[] = [];
  lines.push("wallet,totalBuys,totalClaims");

  for (const [wallet, s] of stats.entries()) {
    lines.push(`${wallet},${s.buys},${s.claims}`);
  }

  const outPath = "wallet-buys-claims.csv";
  fs.writeFileSync(outPath, lines.join("\n"), { encoding: "utf8" });

  console.log(`CSV written to ./${outPath}`);
  console.log("Done ✅");
}

main().catch((err) => {
  console.error("Fatal error in export script:", err);
  process.exit(1);
});
