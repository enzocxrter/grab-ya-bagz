// scripts/export-buys-and-claims.cjs

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// ----------------------
// Config
// ----------------------

// Linea mainnet RPC
const LINEA_RPC_URL =
  process.env.LINEA_RPC_URL || "https://rpc.linea.build";

// TbagDailyFreeBuys contract
const CONTRACT_ADDRESS = "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Approx deploy block (same as you used for leaderboard)
const FROM_BLOCK = 26505044;

// Chunk size (blocks) – small enough to avoid 10k log limit
const BLOCK_CHUNK = 5000;

// TBAG decimals
const TBAG_DECIMALS = 18;

// Event signatures:
// Buy(address indexed user, uint64 userTotalBuys, uint32 buysInCurrentWindow);
const BUY_TOPIC = ethers.utils.id("Buy(address,uint64,uint32)");

// Claim(address indexed user, uint256 buysClaimed, uint256 tokensPaid);
const CLAIM_TOPIC = ethers.utils.id("Claim(address,uint256,uint256)");

async function main() {
  console.log("Using RPC:", LINEA_RPC_URL);
  const provider = new ethers.providers.JsonRpcProvider(LINEA_RPC_URL);

  const latestBlock = await provider.getBlockNumber();
  console.log("Latest block:", latestBlock);

  // Maps
  /** @type {Map<string, number>} */
  const buyCounts = new Map();

  /** @type {Map<string, number>} */
  const claimTxCounts = new Map();

  /** @type {Map<string, number>} */
  const buysClaimedCounts = new Map();

  /** @type {Map<string, ethers.BigNumber>} */
  const tokensClaimed = new Map();

  // 1) Scan Buy events
  console.log("Scanning Buy events...");
  for (let fromBlock = FROM_BLOCK; fromBlock <= latestBlock; fromBlock += BLOCK_CHUNK) {
    const toBlock = Math.min(fromBlock + BLOCK_CHUNK - 1, latestBlock);
    console.log(`  Buy logs: blocks ${fromBlock} -> ${toBlock}`);

    const logs = await provider.getLogs({
      address: CONTRACT_ADDRESS,
      fromBlock,
      toBlock,
      topics: [BUY_TOPIC],
    });

    for (const log of logs) {
      if (!log.topics || log.topics.length < 2) continue;

      const topic = log.topics[1];
      if (!topic || topic.length !== 66) continue;

      try {
        const addr = ethers.utils.getAddress("0x" + topic.slice(26));
        const prev = buyCounts.get(addr) || 0;
        buyCounts.set(addr, prev + 1);
      } catch {
        // ignore malformed
      }
    }
  }

  console.log(`Finished Buy scan. Unique wallets with buys: ${buyCounts.size}`);

  // 2) Scan Claim events
  console.log("Scanning Claim events...");
  for (let fromBlock = FROM_BLOCK; fromBlock <= latestBlock; fromBlock += BLOCK_CHUNK) {
    const toBlock = Math.min(fromBlock + BLOCK_CHUNK - 1, latestBlock);
    console.log(`  Claim logs: blocks ${fromBlock} -> ${toBlock}`);

    const logs = await provider.getLogs({
      address: CONTRACT_ADDRESS,
      fromBlock,
      toBlock,
      topics: [CLAIM_TOPIC],
    });

    for (const log of logs) {
      if (!log.topics || log.topics.length < 2) continue;

      const topic = log.topics[1];
      if (!topic || topic.length !== 66) continue;

      try {
        const addr = ethers.utils.getAddress("0x" + topic.slice(26));

        // data: buysClaimed (uint256) + tokensPaid (uint256)
        const data = log.data.replace(/^0x/, "");
        if (data.length !== 64 * 2) {
          // We expect exactly 2 uint256 (2 * 32 bytes = 64 bytes hex)
          continue;
        }

        const buysClaimedHex = "0x" + data.slice(0, 64);
        const tokensPaidHex = "0x" + data.slice(64, 128);

        const buysClaimed = ethers.BigNumber.from(buysClaimedHex).toNumber();
        const tokensPaid = ethers.BigNumber.from(tokensPaidHex);

        // Count how many claim txs per wallet
        claimTxCounts.set(addr, (claimTxCounts.get(addr) || 0) + 1);

        // Sum total buys claimed per wallet
        buysClaimedCounts.set(
          addr,
          (buysClaimedCounts.get(addr) || 0) + buysClaimed
        );

        // Sum total tokens claimed per wallet
        const prevTokens = tokensClaimed.get(addr) || ethers.BigNumber.from(0);
        tokensClaimed.set(addr, prevTokens.add(tokensPaid));
      } catch (e) {
        // ignore malformed
      }
    }
  }

  console.log(
    `Finished Claim scan. Unique wallets with claim events: ${claimTxCounts.size}`
  );

  // 3) Merge wallets and export CSV
  const allWallets = new Set([
    ...buyCounts.keys(),
    ...claimTxCounts.keys(),
    ...buysClaimedCounts.keys(),
    ...tokensClaimed.keys(),
  ]);

  console.log("Total unique wallets (buys or claims):", allWallets.size);

  const lines = [];
  lines.push(
    [
      "wallet",
      "totalBuys",
      "totalClaimTxs",
      "totalBuysClaimed",
      "totalTokensClaimed_raw",
      "totalTokensClaimed_TBAG",
    ].join(",")
  );

  for (const wallet of allWallets) {
    const totalBuys = buyCounts.get(wallet) || 0;
    const totalClaimTxs = claimTxCounts.get(wallet) || 0;
    const totalBuysClaimed = buysClaimedCounts.get(wallet) || 0;
    const tokensBn = tokensClaimed.get(wallet) || ethers.BigNumber.from(0);

    const tokensRaw = tokensBn.toString();
    const tokensFormatted = ethers.utils.formatUnits(tokensBn, TBAG_DECIMALS);

    lines.push(
      [
        wallet,
        totalBuys,
        totalClaimTxs,
        totalBuysClaimed,
        tokensRaw,
        tokensFormatted,
      ].join(",")
    );
  }

  const outPath = path.join(__dirname, "..", "exported-buys-and-claims.csv");
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  console.log("Done.");
  console.log("Wrote:", outPath);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
