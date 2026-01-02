"use client";

import React, { useEffect, useState } from "react";
import Head from "next/head";
import { ethers } from "ethers";

// --------------------------------------------------
// Config
// --------------------------------------------------

// Linea MAINNET TbagDailyFreeBuys contract
const TBAG_DAILY_BUYS_ADDRESS =
  process.env.NEXT_PUBLIC_TBAG_DAILY_BUYS_ADDRESS ??
  "0xcA2538De53E21128B298a80d92f67b33605FEECC";

// Linea mainnet
const TARGET_CHAIN_ID_DEC = 59144;
const TARGET_CHAIN_ID_HEX = "0xe708";
const TARGET_NETWORK_LABEL = "Linea";

// TBAG decimals (standard)
const TBAG_DECIMALS = 18;

// Linea PoH APIs
const POH_API_BASE = "https://poh-api.linea.build/poh/v2";
const POH_SIGNER_API_BASE = "https://poh-signer-api.linea.build/poh/v2";
const POH_PORTAL_URL =
  "https://linea.build/hub/apps/sumsub-reusable-identity";

// TbagDailyFreeBuys ABI (only what we use)
const TBAG_DAILY_BUYS_ABI = [
  "function tbagPerBuy() view returns (uint256)",
  "function maxBuysPerDay() view returns (uint8)",
  "function totalBuysGlobal() view returns (uint256)",
  "function totalBuys(address user) view returns (uint64)",
  "function claimableBuys(address user) view returns (uint256)",
  "function claimableTokens(address user) view returns (uint256)",
  "function remainingBuysToday(address user) view returns (uint256)",
  "function buy(bytes pohSignature) payable",
  "function claimAll() returns (uint256 buysClaimed, uint256 tokensPaid)",
];

// (Optional) still keep this as a UX cap; API will also cap server-side
const LEADERBOARD_MAX_ENTRIES = 500;

// Allow window.ethereum
declare global {
  interface Window {
    ethereum?: any;
  }
}

type LeaderboardRow = {
  wallet: string;
  totalBuys: number;
};

export default function Home() {
  // --------------------------------------------------
  // Wallet / network
  // --------------------------------------------------
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [autoConnectEnabled, setAutoConnectEnabled] = useState(true);

  let numericChainId: number | null = null;
  if (chainId) {
    numericChainId = chainId.startsWith("0x")
      ? parseInt(chainId, 16)
      : parseInt(chainId, 10);
  }
  const isOnTargetNetwork = numericChainId === TARGET_CHAIN_ID_DEC;

  // --------------------------------------------------
  // Contract data
  // --------------------------------------------------
  const [tbagPerBuy, setTbagPerBuy] = useState<ethers.BigNumber | null>(null);
  const [maxBuysPerDay, setMaxBuysPerDay] = useState<number>(0);
  const [totalBuysGlobal, setTotalBuysGlobal] = useState<number>(0);

  // Per-user
  const [yourTotalBuys, setYourTotalBuys] = useState<number>(0);
  const [remainingBuysToday, setRemainingBuysToday] = useState<number | null>(
    null
  );
  const [claimableBuys, setClaimableBuys] = useState<number | null>(null);
  const [claimableTokens, setClaimableTokens] =
    useState<ethers.BigNumber | null>(null);

  // --------------------------------------------------
  // UI state
  // --------------------------------------------------
  const [activeTab, setActiveTab] = useState<"buy" | "claim">("buy");
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(true);

  // PoH
  const [isPohVerified, setIsPohVerified] = useState<boolean | null>(null);
  const [isCheckingPoh, setIsCheckingPoh] = useState(false);

  // Leaderboard
  const [leaderboardRows, setLeaderboardRows] = useState<LeaderboardRow[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  // --------------------------------------------------
  // Helpers: PoH status (UX only)
  // --------------------------------------------------
  const checkPohStatus = async (address: string) => {
    try {
      setIsCheckingPoh(true);
      setIsPohVerified(null);

      const res = await fetch(`${POH_API_BASE}/${address}`);
      if (!res.ok) throw new Error(`PoH HTTP ${res.status}`);

      const text = (await res.text()).trim(); // "true" or "false"
      setIsPohVerified(text === "true");
    } catch (err) {
      console.error("PoH check failed:", err);
      setIsPohVerified(null);
      setErrorMessage((prev) => prev ?? "Could not check Proof of Humanity.");
    } finally {
      setIsCheckingPoh(false);
    }
  };

  // --------------------------------------------------
  // Load contract data
  // --------------------------------------------------
  const loadContractData = async (address?: string | null) => {
    try {
      setIsLoadingData(true);
      setErrorMessage(null);

      if (typeof window === "undefined" || !window.ethereum) return;

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const contract = new ethers.Contract(
        TBAG_DAILY_BUYS_ADDRESS,
        TBAG_DAILY_BUYS_ABI,
        provider
      );

      // Global
      const [tbagPerBuyBn, maxBuysPerDayBn, totalBuysGlobalBn] =
        await Promise.all([
          contract.tbagPerBuy(),
          contract.maxBuysPerDay(),
          contract.totalBuysGlobal(),
        ]);

      setTbagPerBuy(tbagPerBuyBn);
      setMaxBuysPerDay(Number(maxBuysPerDayBn));
      setTotalBuysGlobal(totalBuysGlobalBn.toNumber());

      if (address) {
        const [
          yourTotalBuysBn,
          remainingBuysTodayBn,
          claimableBuysBn,
          claimableTokensBn,
        ] = await Promise.all([
          contract.totalBuys(address),
          contract.remainingBuysToday(address),
          contract.claimableBuys(address),
          contract.claimableTokens(address),
        ]);

        setYourTotalBuys(Number(yourTotalBuysBn));
        setRemainingBuysToday(remainingBuysTodayBn.toNumber());
        setClaimableBuys(claimableBuysBn.toNumber());
        setClaimableTokens(claimableTokensBn);
      } else {
        setYourTotalBuys(0);
        setRemainingBuysToday(null);
        setClaimableBuys(null);
        setClaimableTokens(null);
      }
    } catch (err) {
      console.error("Error loading contract data:", err);
      setErrorMessage(
        "Error loading contract data. Check network & contract address."
      );
    } finally {
      setIsLoadingData(false);
    }
  };

  // --------------------------------------------------
  // Leaderboard: load from API (cached at edge)
  // --------------------------------------------------
  const loadLeaderboardFromApi = async () => {
    try {
      setIsLoadingLeaderboard(true);
      setLeaderboardError(null);

      const res = await fetch("/api/leaderboard");

      if (!res.ok) {
        const text = await res.text();
        console.error("Leaderboard API error:", res.status, text);
        setLeaderboardError("Could not load leaderboard.");
        setLeaderboardRows([]);
        return;
      }

      const data = await res.json();

      const rows: LeaderboardRow[] = (data.rows ?? [])
        .map((r: any) => ({
          wallet: String(r.wallet ?? "").trim(),
          totalBuys: Number(r.totalBuys ?? 0),
        }))
        .filter((r) => r.wallet) // sanity
        .sort((a, b) => b.totalBuys - a.totalBuys)
        .slice(0, LEADERBOARD_MAX_ENTRIES);

      setLeaderboardRows(rows);
    } catch (err) {
      console.error("Error loading leaderboard:", err);
      setLeaderboardError("Could not load leaderboard.");
      setLeaderboardRows([]);
    } finally {
      setIsLoadingLeaderboard(false);
    }
  };

  // --------------------------------------------------
  // Connect / disconnect
  // --------------------------------------------------
  const connectWallet = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found. Please install it to continue.");
        return;
      }

      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      const selected = accounts[0];
      setWalletAddress(selected);

      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(cid);
      setAutoConnectEnabled(true);

      await Promise.all([loadContractData(selected), checkPohStatus(selected)]);
    } catch (err) {
      console.error("Error connecting wallet:", err);
      setErrorMessage("Failed to connect wallet.");
    }
  };

  const disconnectWallet = () => {
    setWalletAddress(null);
    setChainId(null);
    setYourTotalBuys(0);
    setRemainingBuysToday(null);
    setClaimableBuys(null);
    setClaimableTokens(null);
    setIsPohVerified(null);
    setIsCheckingPoh(false);
    setErrorMessage(null);
    setSuccessMessage(null);
    setAutoConnectEnabled(false);
  };

  // --------------------------------------------------
  // Switch network
  // --------------------------------------------------
  const switchToTargetNetwork = async () => {
    if (typeof window === "undefined" || !window.ethereum) {
      setErrorMessage("MetaMask not found.");
      return;
    }

    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_ID_HEX }],
      });

      const cid = await window.ethereum.request({ method: "eth_chainId" });
      setChainId(cid);

      if (walletAddress) {
        await Promise.all([
          loadContractData(walletAddress),
          checkPohStatus(walletAddress),
        ]);
      }

      setSuccessMessage(`Switched to ${TARGET_NETWORK_LABEL}.`);
    } catch (switchError: any) {
      console.error("Error switching network:", switchError);

      if (switchError?.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: TARGET_CHAIN_ID_HEX,
                chainName: TARGET_NETWORK_LABEL,
                nativeCurrency: {
                  name: "Linea ETH",
                  symbol: "ETH",
                  decimals: 18,
                },
                rpcUrls: ["https://rpc.linea.build"],
                blockExplorerUrls: ["https://lineascan.build"],
              },
            ],
          });

          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: TARGET_CHAIN_ID_HEX }],
          });

          const cid = await window.ethereum.request({
            method: "eth_chainId",
          });
          setChainId(cid);

          if (walletAddress) {
            await Promise.all([
              loadContractData(walletAddress),
              checkPohStatus(walletAddress),
            ]);
          }

          setSuccessMessage(`${TARGET_NETWORK_LABEL} added and selected.`);
        } catch (addError) {
          console.error("Error adding Linea network:", addError);
          setErrorMessage(
            "Failed to add Linea network. Please add it manually."
          );
        }
      } else if (switchError?.code === 4001) {
        setErrorMessage("Network switch was rejected in your wallet.");
      } else {
        setErrorMessage("Failed to switch network in MetaMask.");
      }
    }
  };

  // --------------------------------------------------
  // Buy flow
  // --------------------------------------------------
  const executeBuyTx = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found.");
        return;
      }
      if (!walletAddress) {
        setErrorMessage("Connect your wallet first.");
        return;
      }
      if (!isOnTargetNetwork) {
        setErrorMessage(`Please switch your wallet to ${TARGET_NETWORK_LABEL}.`);
        return;
      }

      // PoH status must be true (UX check)
      if (isPohVerified === false) {
        setErrorMessage(
          "This wallet is not Proof-of-Humanity verified via Linea."
        );
        return;
      }
      if (isPohVerified === null) {
        setErrorMessage("Still checking your PoH status. Try again in a moment.");
        return;
      }

      setIsBuying(true);

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        TBAG_DAILY_BUYS_ADDRESS,
        TBAG_DAILY_BUYS_ABI,
        signer
      );

      // Get PoH signature from Linea signer API
      const sigRes = await fetch(`${POH_SIGNER_API_BASE}/${walletAddress}`);
      if (!sigRes.ok) {
        throw new Error(`PoH signer HTTP ${sigRes.status}`);
      }
      const rawSig = (await sigRes.text()).trim();
      if (!rawSig || !rawSig.startsWith("0x")) {
        throw new Error("Invalid PoH signature format");
      }
      const pohSignature = rawSig;

      // Gas-only buy (msg.value must be 0)
      const tx = await contract.buy(pohSignature, {
        value: 0,
      });

      await tx.wait();

      setSuccessMessage("Buy recorded successfully!");
      setShowConfirmModal(false);

      await Promise.all([
        loadContractData(walletAddress),
        loadLeaderboardFromApi(), // refresh from API after new buy
      ]);
    } catch (err: any) {
      console.error("Buy error:", err);
      const rawMsg =
        err?.error?.message ||
        err?.data?.message ||
        err?.reason ||
        err?.message ||
        String(err ?? "");
      const lower = rawMsg.toLowerCase();

      if (err?.code === "ACTION_REJECTED" || lower.includes("user rejected")) {
        setErrorMessage("Transaction rejected in wallet.");
      } else if (lower.includes("notpohverified")) {
        setErrorMessage("This wallet is not PoH verified.");
      } else if (lower.includes("nonzeroethnotallowed")) {
        setErrorMessage("This contract is gas-only; do not send ETH with the tx.");
      } else if (lower.includes("dailylimitreached")) {
        setErrorMessage("Daily buy limit reached. Try again in the next 24h.");
      } else if (lower.includes("poh") && lower.includes("verify")) {
        setErrorMessage(
          "PoH verification failed. Make sure you completed PoH with this wallet."
        );
      } else if (lower.includes("signer http")) {
        setErrorMessage(
          "Could not fetch PoH signature from Linea. Please try again in a moment."
        );
      } else if (lower.includes("invalid poh signature format")) {
        setErrorMessage(
          "Received invalid PoH signature format. Please try again."
        );
      } else {
        setErrorMessage("Buy transaction failed. Check console for details.");
      }
    } finally {
      setIsBuying(false);
    }
  };

  const handlePrimaryAction = async () => {
    if (!walletAddress) {
      await connectWallet();
      return;
    }
    if (!isOnTargetNetwork) {
      await switchToTargetNetwork();
      return;
    }
    if (isPohVerified === false) {
      // Send them to PoH portal
      window.open(POH_PORTAL_URL, "_blank");
      return;
    }
    setShowConfirmModal(true);
  };

  // --------------------------------------------------
  // Claim flow (claimAll)
  // --------------------------------------------------
  const handleClaimAll = async () => {
    try {
      setErrorMessage(null);
      setSuccessMessage(null);

      if (typeof window === "undefined" || !window.ethereum) {
        setErrorMessage("MetaMask not found.");
        return;
      }
      if (!walletAddress) {
        setErrorMessage("Connect your wallet first.");
        return;
      }
      if (!isOnTargetNetwork) {
        setErrorMessage(`Please switch your wallet to ${TARGET_NETWORK_LABEL}.`);
        return;
      }

      if (!claimableBuys || claimableBuys === 0) {
        setErrorMessage("No buys to claim yet.");
        return;
      }

      setIsClaiming(true);

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const contract = new ethers.Contract(
        TBAG_DAILY_BUYS_ADDRESS,
        TBAG_DAILY_BUYS_ABI,
        signer
      );

      // Optional: preview output with callStatic
      let expectedBuys = claimableBuys;
      let expectedTokens = claimableTokens
        ? claimableTokens.toString()
        : undefined;

      try {
        const [buysClaimed, tokensPaid] = await contract.callStatic.claimAll();
        expectedBuys = buysClaimed.toNumber();
        expectedTokens = tokensPaid.toString();
      } catch {
        // If callStatic fails (e.g. zero balance), we still try and let error bubble.
      }

      const tx = await contract.claimAll();
      await tx.wait();

      const formattedTokens =
        expectedTokens && tbagPerBuy
          ? ethers.utils.formatUnits(expectedTokens, TBAG_DECIMALS)
          : null;

      setSuccessMessage(
        formattedTokens
          ? `Claimed ${expectedBuys} buys for ~${formattedTokens} TBAG.`
          : "Claim successful!"
      );

      await loadContractData(walletAddress);
    } catch (err: any) {
      console.error("Claim error:", err);
      const rawMsg =
        err?.error?.message ||
        err?.data?.message ||
        err?.reason ||
        err?.message ||
        String(err ?? "");
      const lower = rawMsg.toLowerCase();

      if (err?.code === "ACTION_REJECTED" || lower.includes("user rejected")) {
        setErrorMessage("Claim transaction rejected in wallet.");
      } else if (lower.includes("nobuystoclaim")) {
        setErrorMessage("No buys to claim.");
      } else if (lower.includes("tbagperbuynotset")) {
        setErrorMessage("tbagPerBuy is not configured on the contract.");
      } else if (
        lower.includes("insufficientrewardbalance") ||
        lower.includes("insufficient balance")
      ) {
        setErrorMessage(
          "Contract does not have enough TBAG to pay this claim."
        );
      } else if (lower.includes("transferfailed")) {
        setErrorMessage(
          "TBAG transfer failed from contract. Check token balance."
        );
      } else {
        setErrorMessage("Claim transaction failed. Check console for details.");
      }
    } finally {
      setIsClaiming(false);
    }
  };

  // --------------------------------------------------
  // Auto-connect + event listeners
  // --------------------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWalletAddress(null);
        setYourTotalBuys(0);
        setRemainingBuysToday(null);
        setClaimableBuys(null);
        setClaimableTokens(null);
        setIsPohVerified(null);
      } else {
        const acc = accounts[0];
        setWalletAddress(acc);
        loadContractData(acc).catch(console.error);
        checkPohStatus(acc).catch(console.error);
      }
    };

    const handleChainChanged = (cid: string) => {
      setChainId(cid);
      if (walletAddress) {
        loadContractData(walletAddress).catch(console.error);
        checkPohStatus(walletAddress).catch(console.error);
      }
    };

    if (autoConnectEnabled) {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accounts: string[]) => {
          if (accounts.length > 0) {
            const acc = accounts[0];
            setWalletAddress(acc);
            loadContractData(acc).catch(console.error);
            checkPohStatus(acc).catch(console.error);
          }
        })
        .catch(console.error);
    }

    window.ethereum
      .request({ method: "eth_chainId" })
      .then((cid: string) => setChainId(cid))
      .catch(console.error);

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      if (!window.ethereum) return;
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, autoConnectEnabled]);

  // --------------------------------------------------
  // Initial leaderboard load
  // --------------------------------------------------
  useEffect(() => {
    loadLeaderboardFromApi().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --------------------------------------------------
  // Derived labels
  // --------------------------------------------------
  const formattedTbagPerBuy = tbagPerBuy
    ? ethers.utils.formatUnits(tbagPerBuy, TBAG_DECIMALS)
    : "---";

  const formattedClaimableTokens = claimableTokens
    ? ethers.utils.formatUnits(claimableTokens, TBAG_DECIMALS)
    : "0";

  const remainingBuysText = (() => {
    if (!walletAddress) return "-";
    if (maxBuysPerDay === 0) return "0";
    if (remainingBuysToday === null) return "Loading…";
    return `${remainingBuysToday} / ${maxBuysPerDay}`;
  })();

  const buyButtonLabel = (() => {
    if (!walletAddress) return "Connect Wallet";
    if (!isOnTargetNetwork) return `Switch to ${TARGET_NETWORK_LABEL}`;
    if (isCheckingPoh) return "Checking PoH…";
    if (isPohVerified === false) return "Complete PoH Verification";
    if (isBuying) return "Processing Buy...";
    return "Record Free Buy";
  })();

  const isBuyDisabled =
    isBuying || isLoadingData || isCheckingPoh || !TBAG_DAILY_BUYS_ADDRESS;

  const claimButtonLabel = (() => {
    if (!walletAddress) return "Connect Wallet";
    if (!isOnTargetNetwork) return `Switch to ${TARGET_NETWORK_LABEL}`;
    if (isClaiming) return "Claiming...";
    if (claimableBuys !== null && claimableBuys === 0) return "No Buys To Claim";
    return "Claim All TBAG";
  })();

  const isClaimDisabled =
    isClaiming || isLoadingData || !TBAG_DAILY_BUYS_ADDRESS;

  // PoH label
  let pohLabel = "";
  let pohClass = "";
  if (isCheckingPoh) {
    pohLabel = "Checking...";
    pohClass = "checking";
  } else if (isPohVerified === true) {
    pohLabel = "Verified (Linea PoH)";
    pohClass = "ok";
  } else if (walletAddress) {
    pohLabel = "Not verified – required to buy";
    pohClass = "bad";
  }

  // Your rank in leaderboard
  const yourRank = (() => {
    if (!walletAddress || leaderboardRows.length === 0) return null;
    const idx = leaderboardRows.findIndex(
      (row) => row.wallet.toLowerCase() === walletAddress.toLowerCase()
    );
    if (idx === -1) return null;
    return idx + 1;
  })();

  return (
    <>
      <Head>
        <title>Free Daily $TBAG Buys</title>
      </Head>

      <div className="page-root">
        <div className="card">
          <div className="card-header">
            <h1>Grab yer Bagz</h1>
            <p>Claim $TBAG up to 9 times a day. Secure the bag</p>
          </div>

          {/* Status row */}
          <div className="status-row">
            <span
              className={`status-pill ${isOnTargetNetwork ? "ok" : "bad"}`}
            >
              {isOnTargetNetwork ? TARGET_NETWORK_LABEL : "Wrong Network"}
            </span>
            <div className="status-right">
              <span className="status-address">
                {walletAddress
                  ? `Connected: ${walletAddress.slice(
                      0,
                      6
                    )}...${walletAddress.slice(-4)}`
                  : "Not connected"}
              </span>
              {walletAddress && (
                <button
                  className="tiny-btn"
                  type="button"
                  onClick={disconnectWallet}
                >
                  Disconnect
                </button>
              )}
              {walletAddress && !isOnTargetNetwork && (
                <button
                  className="tiny-btn"
                  type="button"
                  onClick={switchToTargetNetwork}
                >
                  Switch Network
                </button>
              )}
            </div>
          </div>

          {/* PoH row */}
          {walletAddress && (
            <div className="poh-row">
              <span className="label">Proof of Humanity</span>
              <span className={`poh-tag ${pohClass}`}>{pohLabel}</span>
            </div>
          )}

          {/* Tabs + Your Rank */}
          <div className="tab-header-row">
            <div className="tabs-row">
              <button
                className={`tab-btn ${activeTab === "buy" ? "active" : ""}`}
                onClick={() => setActiveTab("buy")}
              >
                Buy
              </button>
              <button
                className={`tab-btn ${activeTab === "claim" ? "active" : ""}`}
                onClick={() => setActiveTab("claim")}
              >
                Claim
              </button>
            </div>
            <div className="rank-pill-wrapper">
              <span className="label">Your Rank</span>
              <span className="rank-pill">
                {yourRank
                  ? `#${yourRank}`
                  : walletAddress
                  ? "--"
                  : "Connect to see"}
              </span>
            </div>
          </div>

          {/* BUY TAB */}
          {activeTab === "buy" && (
            <>
              <div className="info-grid">
                <div className="info-box">
                  <span className="label">Remaining Buys (24h)</span>
                  <span className="value">{remainingBuysText}</span>
                </div>
                <div className="info-box">
                  <span className="label">Your Total Buys</span>
                  <span className="value">
                    {walletAddress ? yourTotalBuys : "-"}
                  </span>
                </div>
                <div className="info-box">
                  <span className="label">Total Buys (Global)</span>
                  <span className="value">
                    {totalBuysGlobal.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="info-grid single">
                <div className="info-box">
                  <span className="label">TBAG Per Buy</span>
                  <span className="value">
                    {tbagPerBuy ? `${formattedTbagPerBuy} TBAG` : "---"}
                  </span>
                </div>
              </div>

              <div className="actions-row">
                <button
                  className="primary-btn"
                  onClick={handlePrimaryAction}
                  disabled={isBuyDisabled}
                >
                  {buyButtonLabel}
                </button>
              </div>

              <p className="hint">
                Each buy costs only gas and increases your claimable TBAG by the
                set amount per buy. PoH is required for buys.
              </p>
            </>
          )}

          {/* CLAIM TAB */}
          {activeTab === "claim" && (
            <>
              <div className="info-grid single">
                <div className="info-box">
                  <span className="label">Claimable Buys</span>
                  <span className="value">
                    {walletAddress
                      ? claimableBuys !== null
                        ? claimableBuys
                        : "Loading…"
                      : "-"}
                  </span>
                </div>
              </div>

              <div className="info-grid single">
                <div className="info-box">
                  <span className="label">Claimable TBAG</span>
                  <span className="value">
                    {walletAddress
                      ? `${formattedClaimableTokens} TBAG`
                      : "---"}
                  </span>
                </div>
              </div>

              <div className="actions-row">
                <button
                  className="primary-btn"
                  onClick={handleClaimAll}
                  disabled={isClaimDisabled}
                >
                  {claimButtonLabel}
                </button>
              </div>

              <p className="hint">
                Claim all TBAG owed for your recorded buys in one transaction.
              </p>
            </>
          )}

          {errorMessage && <div className="error-box">{errorMessage}</div>}
          {successMessage && (
            <div className="success-box">{successMessage}</div>
          )}

          {isLoadingData && (
            <div className="hint">Loading contract data from Linea…</div>
          )}
        </div>

        {/* Leaderboard card */}
        <div className="leaderboard-card">
          <div className="leaderboard-header">
            <span className="label">Leaderboard</span>
            <span className="leaderboard-sub">
              Wallets ranked by total free buys
            </span>
          </div>

          {isLoadingLeaderboard && (
            <div className="hint">Loading leaderboard…</div>
          )}

          {leaderboardError && (
            <div className="error-box">{leaderboardError}</div>
          )}

          {!isLoadingLeaderboard && !leaderboardError && (
            <div className="leaderboard-table-wrapper">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Wallet</th>
                    <th>Free Buys</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        style={{ textAlign: "center", padding: "8px" }}
                      >
                        No buys yet. Be the first to grab a bag.
                      </td>
                    </tr>
                  )}
                  {leaderboardRows.map((row, index) => {
                    const isSelf =
                      walletAddress &&
                      row.wallet.toLowerCase() ===
                        walletAddress.toLowerCase();
                    return (
                      <tr
                        key={row.wallet}
                        className={isSelf ? "leaderboard-row-self" : ""}
                      >
                        <td>{index + 1}</td>
                        <td>
                          {row.wallet.slice(0, 6)}...
                          {row.wallet.slice(-4)}
                        </td>
                        <td>{row.totalBuys}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Welcome modal */}
        {showWelcomeModal && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>Time to "Grab yer daily Bagz"</h2>
              <div className="modal-body">
                <p>
                  <strong>How it works:</strong>
                </p>
                <ul>
                  <li>Up to 9 "buys" per day (gas-only, no ETH payment).</li>
                  <li>
                    Each "buy" gives you a fixed amount of $TBAG tokens you can
                    claim straight away.
                  </li>
                  <li>
                    After you "buy", click the claims tab to actually claim your
                    $TBAG Tokens
                  </li>
                </ul>
                <p>
                  PoH verification is required for "buys". Extra rewards for top
                  wallets on the leaderboard
                </p>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => setShowWelcomeModal(false)}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Confirm buy modal */}
        {showConfirmModal && (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h2>Confirm Free "Buy"</h2>
              <p className="modal-body">
                You are about to send a gas-only transaction to record one free
                $TBAG "buy". No ETH is paid to the contract, you only pay the
                $0.01 gas fee. Each "buy" increases your total $TBAG claim each
                day.
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={isBuying}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={executeBuyTx}
                  disabled={isBuying}
                >
                  {isBuying ? "Processing..." : "Confirm Buy"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .page-root {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: radial-gradient(circle at top, #020617 0, #020617 55%);
          color: #f9fafb;
          padding: 24px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          gap: 16px;
        }
        .card {
          max-width: 540px;
          width: 100%;
          background: radial-gradient(circle at top left, #0f172a 0, #020617 60%);
          border-radius: 24px;
          padding: 20px 20px 24px;
          border: 1px solid rgba(148, 163, 184, 0.5);
          box-shadow: 0 0 50px rgba(129, 140, 248, 0.45);
        }
        .card-header h1 {
          margin: 0;
          font-size: 1.7rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .card-header p {
          margin: 6px 0 0;
          font-size: 0.9rem;
          color: #cbd5f5;
        }
        .status-row {
          margin-top: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.8rem;
          gap: 8px;
        }
        .status-pill {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .status-pill.ok {
          background: rgba(34, 197, 94, 0.14);
          border-color: rgba(34, 197, 94, 0.8);
          color: #bbf7d0;
        }
        .status-pill.bad {
          background: rgba(248, 113, 113, 0.12);
          border-color: rgba(248, 113, 113, 0.8);
          color: #fecaca;
        }
        .status-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }
        .status-address {
          opacity: 0.9;
        }
        .tiny-btn {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
          background: rgba(15, 23, 42, 0.9);
          color: #e5e7eb;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .tiny-btn:hover {
          background: rgba(37, 99, 235, 0.8);
        }
        .poh-row {
          margin-top: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 0.78rem;
        }
        .poh-tag {
          padding: 3px 8px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
        }
        .poh-tag.ok {
          background: rgba(34, 197, 94, 0.12);
          border-color: rgba(34, 197, 94, 0.8);
          color: #bbf7d0;
        }
        .poh-tag.bad {
          background: rgba(248, 113, 113, 0.12);
          border-color: rgba(248, 113, 113, 0.8);
          color: #fecaca;
        }
        .poh-tag.checking {
          opacity: 0.9;
        }

        /* Tabs + Rank row */
        .tab-header-row {
          margin-top: 18px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .tabs-row {
          display: inline-flex;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: rgba(15, 23, 42, 0.9);
          padding: 3px;
        }
        .tab-btn {
          border: none;
          background: transparent;
          color: #e5e7eb;
          padding: 6px 18px;
          border-radius: 999px;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          cursor: pointer;
        }
        .tab-btn.active {
          background: linear-gradient(135deg, #6366f1, #ec4899);
          box-shadow: 0 6px 18px rgba(129, 140, 248, 0.9);
        }
        .rank-pill-wrapper {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }
        .rank-pill {
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          background: radial-gradient(
            circle at top left,
            rgba(79, 70, 229, 0.5),
            rgba(15, 23, 42, 0.9)
          );
          font-size: 0.8rem;
          font-weight: 500;
          min-width: 48px;
          text-align: center;
        }

        .info-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-top: 16px;
        }
        .info-grid.single {
          grid-template-columns: 1fr;
        }
        .info-box {
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: radial-gradient(
            circle at top left,
            rgba(79, 70, 229, 0.3),
            rgba(15, 23, 42, 0.95)
          );
        }
        .label {
          display: block;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.09em;
          color: #9ca3af;
          margin-bottom: 2px;
        }
        .value {
          font-size: 0.95rem;
          font-weight: 500;
        }
        .actions-row {
          margin-top: 18px;
        }
        .primary-btn {
          width: 100%;
          padding: 10px 14px;
          border-radius: 999px;
          border: none;
          font-size: 0.9rem;
          cursor: pointer;
          background: linear-gradient(135deg, #6366f1, #ec4899);
          color: white;
          box-shadow: 0 12px 30px rgba(129, 140, 248, 0.7);
          transition: transform 0.12s ease, box-shadow 0.12s ease,
            opacity 0.12s ease;
        }
        .primary-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 16px 40px rgba(129, 140, 248, 0.95);
        }
        .primary-btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        .secondary-btn {
          padding: 8px 14px;
          border-radius: 999px;
          border: 1px solid rgba(148, 163, 184, 0.6);
          background: rgba(15, 23, 42, 0.95);
          color: #e5e7eb;
          font-size: 0.85rem;
          cursor: pointer;
          margin-right: 8px;
        }
        .secondary-btn:hover:not(:disabled) {
          background: rgba(37, 99, 235, 0.8);
        }
        .hint {
          margin-top: 10px;
          font-size: 0.75rem;
          color: #9ca3af;
        }
        .error-box {
          margin-top: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.7);
          font-size: 0.8rem;
          color: #fecaca;
        }
        .success-box {
          margin-top: 12px;
          padding: 8px 10px;
          border-radius: 8px;
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.8);
          font-size: 0.8rem;
          color: #bbf7d0;
        }

        /* Leaderboard */
        .leaderboard-card {
          max-width: 540px;
          width: 100%;
          background: radial-gradient(
            circle at top left,
            #020617 0,
            #020617 60%
          );
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          box-shadow: 0 0 35px rgba(129, 140, 248, 0.4);
          padding: 14px 16px 16px;
        }
        .leaderboard-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .leaderboard-sub {
          font-size: 0.7rem;
          color: #9ca3af;
        }
        .leaderboard-table-wrapper {
          max-height: 220px;
          overflow-y: auto;
          border-radius: 12px;
          border: 1px solid rgba(148, 163, 184, 0.4);
          background: rgba(15, 23, 42, 0.85);
        }
        .leaderboard-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.8rem;
        }
        .leaderboard-table th,
        .leaderboard-table td {
          padding: 6px 10px;
          text-align: left;
          border-bottom: 1px solid rgba(30, 64, 175, 0.3);
        }
        .leaderboard-table th {
          font-weight: 500;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          font-size: 0.7rem;
          background: rgba(15, 23, 42, 0.95);
        }
        .leaderboard-table tr:nth-child(even) td {
          background: rgba(15, 23, 42, 0.8);
        }
        .leaderboard-table tr:nth-child(odd) td {
          background: rgba(15, 23, 42, 0.95);
        }
        .leaderboard-row-self td {
          background: radial-gradient(
            circle at top left,
            rgba(34, 197, 94, 0.35),
            rgba(15, 23, 42, 0.95)
          );
          border-bottom-color: rgba(34, 197, 94, 0.9);
          color: #ecfdf5;
        }
        .leaderboard-footer {
          margin-top: 8px;
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          font-size: 0.75rem;
        }

        /* Modals */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
        }
        .modal-card {
          max-width: 420px;
          width: 100%;
          background: radial-gradient(
            circle at top left,
            #020617 0,
            #020617 60%
          );
          border-radius: 20px;
          border: 1px solid rgba(148, 163, 184, 0.7);
          box-shadow: 0 0 40px rgba(129, 140, 248, 0.7);
          padding: 18px 18px 16px;
        }
        .modal-card h2 {
          margin: 0 0 8px;
          font-size: 1.15rem;
        }
        .modal-body {
          font-size: 0.78rem;
          color: #cbd5f5;
        }
        .modal-body ul {
          margin: 6px 0 10px;
          padding-left: 1.2rem;
        }
        .modal-body li {
          margin-bottom: 4px;
        }
        .modal-actions {
          margin-top: 14px;
          display: flex;
          justify-content: flex-end;
        }

        @media (max-width: 640px) {
          .card {
            padding: 18px 14px 22px;
          }
          .card-header h1 {
            font-size: 1.45rem;
          }
          .info-grid {
            grid-template-columns: 1fr;
          }
          .leaderboard-card {
            padding: 14px 12px 16px;
          }
          .tab-header-row {
            flex-direction: column;
            align-items: flex-start;
          }
          .rank-pill-wrapper {
            align-items: flex-start;
          }
        }
      `}</style>
    </>
  );
}
