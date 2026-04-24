# 🔒 StealthPerp
### Private Perpetuals DEX on Solana — powered by Arcium Confidential Computing



![Solana](https://img.shields.io/badge/Solana-9945FF?style=flat&logo=solana&logoColor=white)




![Arcium](https://img.shields.io/badge/Arcium_MPC-6B3FD4?style=flat&logoColor=white)




![Anchor](https://img.shields.io/badge/Anchor-1E7EF5?style=flat&logoColor=white)




![License](https://img.shields.io/badge/License-MIT-22863A?style=flat)



---

## Overview

StealthPerp is a perpetuals trading protocol on Solana that uses **Arcium's Multiparty Computation (MPC)** network to keep trader positions, order sizes, and liquidation thresholds completely private. Only the final PnL is revealed at settlement.

On traditional on-chain perp DEXs, every position is written to a public ledger in plaintext. This exposes traders to three critical adversarial risks:

- **Copy-trading bots** that mirror large positions in real time
- **Front-runners** who detect large orders and trade ahead of them
- **Targeted liquidation hunters** who push price to known liquidation levels

StealthPerp eliminates all three by routing privacy-critical computations through Arcium's encrypted MPC environment.

---

## Privacy Comparison

| Attack Vector | Traditional DEX | StealthPerp + Arcium |
|---|---|---|
| Copy-trading | ❌ Exposed | ✅ MPC-sealed |
| Front-running | ❌ Exposed | ✅ Encrypted |
| Targeted Liquidation | ❌ Vulnerable | ✅ Private liq threshold |
| Position Size Leak | ❌ On-chain | ✅ Ciphertext only |
| Settlement Privacy | ❌ Full exposure | ✅ PnL only revealed |

---

## How Arcium is Used

Arcium's **MXE (Multiparty Execution)** environment is integrated at four points:

### 1. Encrypted Order Submission
Position size, direction, and price are encrypted **client-side** using Arcium's threshold encryption before the transaction is signed. The plaintext never leaves the user's browser.

### 2. MPC-Based Order Matching & Margin Check
Arcium's MXE cluster computes order matching and margin checks across **3-of-5 MPC nodes** — entirely over ciphertexts. No single node can reconstruct the plaintext inputs.

### 3. Private Liquidation Checks
A keeper bot continuously queries Arcium to evaluate whether any encrypted position has breached its margin threshold, using the public **Pyth oracle price** as the only public input. Liquidation fires without the threshold price ever being revealed.

### 4. PnL-Only Settlement
On position close, Arcium decrypts **only the net PnL** and passes it to the Solana program for USDC settlement. Entry price, size, and liquidation level remain sealed permanently.

---

## Trade Lifecycle

| # | Actor | Action |
|---|---|---|
| 1 | User (Browser) | Encrypts position size, direction & price with Arcium threshold key. Ciphertext posted to Solana program. |
| 2 | Solana Program | Stores encrypted position commitment on-chain. Emits event for Arcium keeper. No plaintext ever written to chain. |
| 3 | Arcium MXE | 3-of-5 MPC nodes jointly compute order matching and margin check over ciphertexts. Zero plaintext exposure. |
| 4 | Arcium MXE | Continuously evaluates encrypted margin ratios against Pyth prices. Fires liquidation privately. |
| 5 | Solana Program | On close: Arcium decrypts only net PnL. USDC settled on-chain. All other fields remain encrypted forever. |

---

## Architecture

| Component | Technology | Privacy Role |
|---|---|---|
| Smart Contract | Anchor (Rust) on Solana | Stores encrypted position commitments |
| MPC Engine | Arcium MXE cluster | Computes matching & margin over ciphertexts |
| Liquidation Keeper | TypeScript + Arcium SDK | Private liquidation checks |
| Frontend | React + Solana Wallet Adapter | Client-side encryption before any network call |
| Price Oracle | Pyth Network | Only public input to the system |

---

## Repository Structure
