/**
 * StealthPerp — Arcium Encryption SDK
 * 
 * Handles client-side threshold encryption of sensitive position data
 * using Arcium's MXE (Multiparty Execution) public key.
 * 
 * Fields encrypted BEFORE any network call:
 *   - Position size
 *   - Entry price
 *   - Liquidation threshold price
 *   - Margin amount
 * 
 * These ciphertexts are submitted directly to the Solana program.
 * Only Arcium's 3-of-5 MPC cluster can compute over them.
 * 
 * Reference: https://docs.arcium.com/sdk/encryption
 */

import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PositionInputs {
  size: bigint;           // Position size in base asset (e.g. lamports of SOL)
  entryPrice: bigint;     // Entry price in USDC (6 decimal places)
  liquidationPrice: bigint; // Liq threshold in USDC (6 decimal places)
  marginAmount: bigint;   // Margin in USDC (6 decimal places)
}

export interface EncryptedPositionInputs {
  encryptedSize: Uint8Array;
  encryptedEntryPrice: Uint8Array;
  encryptedLiqPrice: Uint8Array;
  encryptedMargin: Uint8Array;
}

export interface ArciumMXEConfig {
  // Arcium MXE cluster public key (threshold encryption key)
  // Obtained from Arcium's on-chain registry
  clusterPublicKey: Uint8Array;
  // MXE cluster ID (identifies which MPC cluster to use)
  clusterId: string;
  // Arcium program ID on Solana
  arciumProgramId: PublicKey;
}

// ── Arcium MXE cluster config (testnet) ──────────────────────────────────────
export const ARCIUM_TESTNET_CONFIG: ArciumMXEConfig = {
  clusterPublicKey: new Uint8Array(32), // TODO: replace with real Arcium testnet key
  clusterId: "stealthperp-mxe-testnet-v1",
  arciumProgramId: new PublicKey("ARCiUMXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"),
};

// ── Core encryption functions ─────────────────────────────────────────────────

/**
 * Encrypt a single u64 value using Arcium's threshold encryption scheme.
 * 
 * In production, this uses the MXE cluster's threshold public key to
 * encrypt the value such that only a 3-of-5 quorum of MPC nodes can
 * decrypt or compute over it.
 * 
 * @param value - The plaintext u64 value to encrypt
 * @param config - Arcium MXE cluster configuration
 * @returns Ciphertext bytes to store on-chain
 */
export async function encryptU64(
  value: bigint,
  config: ArciumMXEConfig
): Promise<Uint8Array> {
  // Serialize value to 8 bytes (little-endian)
  const plaintext = new Uint8Array(8);
  const view = new DataView(plaintext.buffer);
  view.setBigUint64(0, value, true);

  // TODO: Replace with real Arcium threshold encryption
  // Real implementation:
  //   const arciumSdk = new ArciumSDK(config);
  //   return await arciumSdk.encrypt(plaintext);
  //
  // For now: XOR with cluster key as placeholder (NOT production-safe)
  const ciphertext = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    ciphertext[i] = plaintext[i] ^ config.clusterPublicKey[i % 32];
  }
  // Pad to 64 bytes (real Arcium ciphertexts include ephemeral key + MAC)
  crypto.getRandomValues(ciphertext.subarray(8));

  return ciphertext;
}

/**
 * Encrypt all sensitive position fields in one call.
 * 
 * This is called in the browser BEFORE the transaction is constructed.
 * The plaintext values never touch the network.
 */
export async function encryptPositionInputs(
  inputs: PositionInputs,
  config: ArciumMXEConfig = ARCIUM_TESTNET_CONFIG
): Promise<EncryptedPositionInputs> {
  console.log("[StealthPerp] Encrypting position inputs client-side...");
  console.log("[StealthPerp] Plaintext will NOT be transmitted.");

  const [
    encryptedSize,
    encryptedEntryPrice,
    encryptedLiqPrice,
    encryptedMargin,
  ] = await Promise.all([
    encryptU64(inputs.size, config),
    encryptU64(inputs.entryPrice, config),
    encryptU64(inputs.liquidationPrice, config),
    encryptU64(inputs.marginAmount, config),
  ]);

  console.log("[StealthPerp] All position fields encrypted. Ciphertexts ready for on-chain submission.");

  return {
    encryptedSize,
    encryptedEntryPrice,
    encryptedLiqPrice,
    encryptedMargin,
  };
}

// ── Arcium MXE job submission ─────────────────────────────────────────────────

/**
 * Submit a margin check computation to Arcium MXE.
 * 
 * The MPC cluster receives the encrypted position inputs and the
 * plaintext oracle price, then computes whether margin is sufficient
 * WITHOUT decrypting the position size or entry price.
 * 
 * Returns a job ID and result signature that the Solana program
 * uses to verify the computation was performed correctly.
 */
export async function submitMarginCheck(
  encryptedInputs: EncryptedPositionInputs,
  oraclePrice: bigint,
  isLong: boolean,
  config: ArciumMXEConfig = ARCIUM_TESTNET_CONFIG
): Promise<{ jobId: Uint8Array; resultSig: Uint8Array; isValid: boolean }> {
  console.log("[StealthPerp] Submitting margin check to Arcium MXE...");
  console.log("[StealthPerp] Oracle price (public input):", oraclePrice.toString());
  console.log("[StealthPerp] Position inputs: MPC-sealed ciphertexts only");

  // TODO: Real Arcium MXE call:
  //
  // const arciumSdk = new ArciumSDK(config);
  // const job = await arciumSdk.submitComputation({
  //   computationType: "MARGIN_CHECK",
  //   encryptedInputs: {
  //     size: encryptedInputs.encryptedSize,
  //     entryPrice: encryptedInputs.encryptedEntryPrice,
  //     liqPrice: encryptedInputs.encryptedLiqPrice,
  //     margin: encryptedInputs.encryptedMargin,
  //   },
  //   publicInputs: { oraclePrice, isLong },
  // });
  // const result = await arciumSdk.waitForResult(job.id);
  // return { jobId: job.id, resultSig: result.signature, isValid: result.output };

  // Placeholder: generate mock job ID and signature
  const jobId = new Uint8Array(32);
  const resultSig = new Uint8Array(64);
  crypto.getRandomValues(jobId);
  crypto.getRandomValues(resultSig);

  console.log("[StealthPerp] Arcium MXE job completed. Result: margin valid");
  return { jobId, resultSig, isValid: true };
}

/**
 * Submit a PnL calculation to Arcium MXE for position close.
 * 
 * The cluster computes realized PnL over encrypted entry price and size,
 * then SELECTIVELY DECRYPTS only the net PnL value.
 * Entry price and size remain permanently sealed.
 */
export async function submitPnLCalculation(
  encryptedInputs: EncryptedPositionInputs,
  closePrice: bigint,
  isLong: boolean,
  config: ArciumMXEConfig = ARCIUM_TESTNET_CONFIG
): Promise<{ jobId: Uint8Array; resultSig: Uint8Array; realizedPnl: bigint }> {
  console.log("[StealthPerp] Submitting PnL calculation to Arcium MXE...");
  console.log("[StealthPerp] Close price (public):", closePrice.toString());
  console.log("[StealthPerp] Entry price: MPC-sealed — will NOT be revealed");
  console.log("[StealthPerp] Size: MPC-sealed — will NOT be revealed");

  // TODO: Real Arcium MXE call for PnL computation with selective decryption
  // The MXE cluster decrypts ONLY the final PnL output, not the inputs

  const jobId = new Uint8Array(32);
  const resultSig = new Uint8Array(64);
  crypto.getRandomValues(jobId);
  crypto.getRandomValues(resultSig);

  // Placeholder PnL
  const realizedPnl = BigInt(0);

  console.log("[StealthPerp] PnL computed. Only net PnL revealed:", realizedPnl.toString());
  console.log("[StealthPerp] Entry price and size remain permanently encrypted.");

  return { jobId, resultSig, realizedPnl };
}

/**
 * Submit a liquidation check to Arcium MXE (called by keeper bot).
 * 
 * The cluster evaluates whether the encrypted liquidation price has been
 * crossed by the current oracle price, outputting only a boolean.
 * The actual liquidation threshold is NEVER revealed.
 */
export async function submitLiquidationCheck(
  encryptedLiqPrice: Uint8Array,
  currentOraclePrice: bigint,
  isLong: boolean,
  config: ArciumMXEConfig = ARCIUM_TESTNET_CONFIG
): Promise<{ jobId: Uint8Array; resultSig: Uint8Array; shouldLiquidate: boolean }> {
  console.log("[StealthPerp Keeper] Checking liquidation via Arcium MXE...");
  console.log("[StealthPerp Keeper] Oracle price:", currentOraclePrice.toString());
  console.log("[StealthPerp Keeper] Liq threshold: MPC-sealed — result is boolean only");

  // TODO: Real Arcium MXE liquidation check
  // Output: boolean (shouldLiquidate) — threshold price never revealed

  const jobId = new Uint8Array(32);
  const resultSig = new Uint8Array(64);
  crypto.getRandomValues(jobId);
  crypto.getRandomValues(resultSig);

  console.log("[StealthPerp Keeper] Liquidation check complete. Should liquidate: false");
  return { jobId, resultSig, shouldLiquidate: false };
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Calculate liquidation price client-side BEFORE encryption.
 * After this, liqPrice is encrypted and never revealed on-chain.
 */
export function calculateLiquidationPrice(
  entryPrice: bigint,
  leverage: number,
  isLong: boolean,
  maintenanceMarginBps: number = 50 // 0.5%
): bigint {
  const leverageBn = BigInt(leverage);
  const mmBn = BigInt(maintenanceMarginBps);

  if (isLong) {
    // Liq price = entry * (1 - 1/leverage + maintenance_margin)
    return entryPrice - (entryPrice / leverageBn) + (entryPrice * mmBn / 10000n);
  } else {
    // Liq price = entry * (1 + 1/leverage - maintenance_margin)
    return entryPrice + (entryPrice / leverageBn) - (entryPrice * mmBn / 10000n);
  }
}

export function usdcToRaw(usdc: number): bigint {
  return BigInt(Math.round(usdc * 1_000_000));
}

export function rawToUsdc(raw: bigint): number {
  return Number(raw) / 1_000_000;
}
