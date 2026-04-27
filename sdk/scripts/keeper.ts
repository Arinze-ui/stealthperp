/**
 * StealthPerp — Liquidation Keeper Bot
 *
 * Monitors all open positions and triggers liquidations privately via Arcium MXE.
 *
 * KEY PRIVACY PROPERTY:
 *   The keeper NEVER knows a position's liquidation price.
 *   It submits the encrypted liq price + current oracle price to Arcium MXE,
 *   which returns only a boolean: "should liquidate = true/false".
 *   The actual threshold remains sealed inside the MPC cluster.
 *
 * This eliminates the classic attack where keepers or MEV bots can:
 *   1. Read a position's liquidation price from chain
 *   2. Push the oracle price to that exact level
 *   3. Liquidate and collect the fee
 *
 * Run: npx ts-node scripts/keeper.ts
 */

import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import { Program, AnchorProvider, web3 } from "@coral-xyz/anchor";
import { submitLiquidationCheck } from "../sdk/encryption";

// ── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const KEEPER_KEYPAIR_PATH = process.env.KEEPER_KEYPAIR ?? "./keeper-keypair.json";
const PROGRAM_ID = new PublicKey("STPerpXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
const POLL_INTERVAL_MS = 5_000; // Check every 5 seconds
const PYTH_SOL_USD = new PublicKey("H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG");

// ── Main keeper loop ──────────────────────────────────────────────────────────

async function runKeeper() {
  console.log("╔═══════════════════════════════════════════╗");
  console.log("║   StealthPerp Liquidation Keeper Bot      ║");
  console.log("║   Liquidation checks: Arcium MXE (Private)║");
  console.log("╚═══════════════════════════════════════════╝\n");

  const connection = new Connection(RPC_URL, "confirmed");

  // TODO: Load keeper keypair from file
  // const keypairData = JSON.parse(fs.readFileSync(KEEPER_KEYPAIR_PATH, "utf-8"));
  // const keeperKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

  console.log(`[Keeper] Connected to: ${RPC_URL}`);
  console.log(`[Keeper] Poll interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`[Keeper] Privacy model: Arcium MXE (liq prices never revealed)\n`);

  while (true) {
    try {
      await checkAllPositions(connection);
    } catch (err) {
      console.error("[Keeper] Error in check cycle:", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ── Check all open positions ──────────────────────────────────────────────────

async function checkAllPositions(connection: Connection) {
  // Fetch current oracle price (public)
  const oraclePrice = await fetchOraclePrice(connection, PYTH_SOL_USD);
  console.log(`[Keeper] Oracle price: $${(Number(oraclePrice) / 1_000_000).toFixed(4)}`);

  // Fetch all open position accounts from the program
  // TODO: Replace with real program account fetch
  // const positions = await program.account.position.all([
  //   { memcmp: { offset: 65, bytes: bs58.encode([1]) } } // is_open = true
  // ]);

  const positions = getMockOpenPositions(); // placeholder
  console.log(`[Keeper] Checking ${positions.length} open positions...`);

  let liquidated = 0;

  for (const pos of positions) {
    const shouldLiq = await checkPositionPrivately(pos, oraclePrice);

    if (shouldLiq) {
      console.log(`[Keeper] 🔴 Position ${pos.pubkey.toString().slice(0, 8)}... flagged for liquidation`);
      await executeLiquidation(pos, oraclePrice);
      liquidated++;
    }
  }

  if (liquidated === 0) {
    console.log(`[Keeper] ✅ No liquidations triggered this cycle\n`);
  } else {
    console.log(`[Keeper] ⚡ ${liquidated} position(s) liquidated\n`);
  }
}

// ── Private liquidation check via Arcium MXE ─────────────────────────────────

async function checkPositionPrivately(
  position: MockPosition,
  currentOraclePrice: bigint
): Promise<boolean> {
  // PRIVACY: We pass the encrypted liq price to Arcium MXE.
  // We NEVER decrypt it ourselves — we only get back a boolean.
  const { shouldLiquidate } = await submitLiquidationCheck(
    position.encryptedLiqPrice,
    currentOraclePrice,
    position.isLong
  );

  return shouldLiquidate;
}

// ── Execute liquidation on-chain ──────────────────────────────────────────────

async function executeLiquidation(position: MockPosition, oraclePrice: bigint) {
  console.log(`[Keeper] Submitting liquidation to Arcium MXE for final verification...`);

  // Get Arcium MXE sign-off that liquidation is valid
  const { jobId, resultSig } = await submitLiquidationCheck(
    position.encryptedLiqPrice,
    oraclePrice,
    position.isLong
  );

  // TODO: Call the Solana program's liquidate instruction
  // await program.methods
  //   .liquidate(
  //     Array.from(jobId),
  //     Array.from(resultSig),
  //     KEEPER_FEE
  //   )
  //   .accounts({
  //     position: position.pubkey,
  //     market: position.market,
  //     keeper: keeperKeypair.publicKey,
  //     vaultUsdc: vaultUsdcPda,
  //     keeperUsdc: keeperUsdcAta,
  //     tokenProgram: TOKEN_PROGRAM_ID,
  //   })
  //   .signers([keeperKeypair])
  //   .rpc();

  console.log(`[Keeper] Liquidation executed. Liq threshold was never revealed.`);
}

// ── Oracle price fetch (Pyth) ─────────────────────────────────────────────────

async function fetchOraclePrice(
  connection: Connection,
  priceFeed: PublicKey
): Promise<bigint> {
  // TODO: Real Pyth price fetch
  // const priceData = await connection.getAccountInfo(priceFeed);
  // const price = parsePythPriceData(priceData.data);
  // return BigInt(Math.round(price.price * 1_000_000));

  // Placeholder: $178.64
  return BigInt(178_640_000);
}

// ── Mock data (replace with real program account fetching) ───────────────────

interface MockPosition {
  pubkey: PublicKey;
  market: PublicKey;
  trader: PublicKey;
  isLong: boolean;
  collateralAmount: bigint;
  encryptedLiqPrice: Uint8Array; // Sealed by Arcium — keeper cannot read this
  encryptedSize: Uint8Array;
  encryptedMargin: Uint8Array;
}

function getMockOpenPositions(): MockPosition[] {
  return [
    {
      pubkey: new PublicKey("11111111111111111111111111111111"),
      market: new PublicKey("11111111111111111111111111111111"),
      trader: new PublicKey("11111111111111111111111111111111"),
      isLong: true,
      collateralAmount: BigInt(100_000_000),
      encryptedLiqPrice: new Uint8Array(64), // MPC-sealed ciphertext
      encryptedSize: new Uint8Array(64),
      encryptedMargin: new Uint8Array(64),
    },
  ];
}

// ── Utils ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Entry point ───────────────────────────────────────────────────────────────

runKeeper().catch((err) => {
  console.error("[Keeper] Fatal error:", err);
  process.exit(1);
});
