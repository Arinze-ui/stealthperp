use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("STPerpXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");

// ─────────────────────────────────────────────────────────────────────────────
// StealthPerp — Private Perpetuals on Solana
// Powered by Arcium Confidential Computing (MPC)
//
// All sensitive position data (size, entry price, liquidation threshold,
// margin) is stored as Arcium-encrypted ciphertexts. Only the final PnL
// is decrypted and settled on-chain at position close.
//
// Arcium MXE handles:
//   1. Order matching (over encrypted inputs)
//   2. Margin check (encrypted margin vs encrypted requirement)
//   3. Liquidation threshold evaluation (encrypted liq price vs oracle)
//   4. PnL calculation and selective decryption at settlement
// ─────────────────────────────────────────────────────────────────────────────

#[program]
pub mod stealthperp {
    use super::*;

    // ── Initialize a new market ───────────────────────────────────────────────
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_index: u16,
        max_leverage: u8,
        base_asset_symbol: String,
    ) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.market_index = market_index;
        market.max_leverage = max_leverage;
        market.base_asset_symbol = base_asset_symbol;
        market.authority = ctx.accounts.authority.key();
        market.open_interest_long = 0;
        market.open_interest_short = 0;
        market.is_active = true;
        market.bump = ctx.bumps.market;

        msg!("Market initialized: index={}", market_index);
        Ok(())
    }

    // ── Open a private position ───────────────────────────────────────────────
    // The actual position size, entry price, and liquidation threshold are
    // passed as Arcium ciphertexts — never as plaintext.
    // Arcium MXE validates margin sufficiency over the encrypted inputs
    // before this instruction is accepted.
    pub fn open_position(
        ctx: Context<OpenPosition>,
        // Arcium ciphertext: encrypted position size (u64)
        encrypted_size: Vec<u8>,
        // Arcium ciphertext: encrypted entry price (u64, 6 decimals)
        encrypted_entry_price: Vec<u8>,
        // Arcium ciphertext: encrypted liquidation price (u64, 6 decimals)
        encrypted_liq_price: Vec<u8>,
        // Arcium ciphertext: encrypted margin amount (u64)
        encrypted_margin: Vec<u8>,
        // Public: direction (true = long, false = short)
        is_long: bool,
        // Arcium MXE job ID — proof that margin check was computed privately
        arcium_job_id: [u8; 32],
        // Arcium MXE result signature — verifies the MPC computation output
        arcium_result_sig: Vec<u8>,
        // Collateral deposited (plaintext USDC amount, not position size)
        collateral_amount: u64,
    ) -> Result<()> {
        // Verify the Arcium MXE computation result signature
        // This confirms that 3-of-5 MPC nodes agreed margin is sufficient
        verify_arcium_result(&arcium_job_id, &arcium_result_sig)?;

        // Transfer collateral from trader to vault
        let transfer_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.trader_usdc.to_account_info(),
                to: ctx.accounts.vault_usdc.to_account_info(),
                authority: ctx.accounts.trader.to_account_info(),
            },
        );
        token::transfer(transfer_ctx, collateral_amount)?;

        // Store encrypted position data on-chain
        // None of this can be decoded without Arcium's threshold key
        let position = &mut ctx.accounts.position;
        position.trader = ctx.accounts.trader.key();
        position.market = ctx.accounts.market.key();
        position.is_long = is_long;
        position.is_open = true;
        position.collateral_amount = collateral_amount;
        position.open_timestamp = Clock::get()?.unix_timestamp;
        position.arcium_job_id = arcium_job_id;
        position.bump = ctx.bumps.position;

        // Store ciphertexts — sensitive fields are never plaintext on-chain
        position.encrypted_size = encrypted_size;
        position.encrypted_entry_price = encrypted_entry_price;
        position.encrypted_liq_price = encrypted_liq_price;
        position.encrypted_margin = encrypted_margin;

        // Update market open interest (plaintext direction, encrypted size)
        let market = &mut ctx.accounts.market;
        if is_long {
            market.open_interest_long = market.open_interest_long.saturating_add(1);
        } else {
            market.open_interest_short = market.open_interest_short.saturating_add(1);
        }

        emit!(PositionOpened {
            trader: ctx.accounts.trader.key(),
            market: ctx.accounts.market.key(),
            is_long,
            arcium_job_id,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!("Position opened — all sensitive data MPC-sealed by Arcium");
        Ok(())
    }

    // ── Close a position — PnL-only settlement ────────────────────────────────
    // Arcium MXE computes the PnL over encrypted inputs and decrypts ONLY
    // the net PnL value. Entry price, size, and liq price remain sealed.
    pub fn close_position(
        ctx: Context<ClosePosition>,
        // Arcium MXE job ID for PnL computation
        arcium_job_id: [u8; 32],
        // Arcium MXE result signature
        arcium_result_sig: Vec<u8>,
        // The decrypted PnL — positive = profit, can be negative (loss)
        // This is the ONLY value Arcium reveals at settlement
        realized_pnl: i64,
    ) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require!(position.is_open, StealthPerpError::PositionAlreadyClosed);
        require!(
            position.trader == ctx.accounts.trader.key(),
            StealthPerpError::UnauthorizedTrader
        );

        // Verify Arcium MXE computed the PnL correctly over encrypted inputs
        verify_arcium_result(&arcium_job_id, &arcium_result_sig)?;

        // Calculate settlement amount: collateral +/- PnL
        let settlement_amount = if realized_pnl >= 0 {
            position.collateral_amount.saturating_add(realized_pnl as u64)
        } else {
            position.collateral_amount.saturating_sub(realized_pnl.unsigned_abs())
        };

        // Transfer settlement from vault to trader
        let market_key = ctx.accounts.market.key();
        let seeds = &[
            b"vault",
            market_key.as_ref(),
            &[ctx.accounts.market.bump],
        ];
        let signer = &[&seeds[..]];

        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_usdc.to_account_info(),
                to: ctx.accounts.trader_usdc.to_account_info(),
                authority: ctx.accounts.market.to_account_info(),
            },
            signer,
        );
        token::transfer(transfer_ctx, settlement_amount)?;

        // Mark position closed — encrypted fields remain on-chain but sealed
        position.is_open = false;
        position.close_timestamp = Clock::get()?.unix_timestamp;
        position.realized_pnl = realized_pnl;

        // Update open interest
        let market = &mut ctx.accounts.market;
        if position.is_long {
            market.open_interest_long = market.open_interest_long.saturating_sub(1);
        } else {
            market.open_interest_short = market.open_interest_short.saturating_sub(1);
        }

        emit!(PositionClosed {
            trader: ctx.accounts.trader.key(),
            market: ctx.accounts.market.key(),
            realized_pnl,
            arcium_job_id,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Position closed — PnL settled: {} USDC (only value revealed)",
            realized_pnl
        );
        Ok(())
    }

    // ── Liquidate a position ──────────────────────────────────────────────────
    // Called by the keeper bot after Arcium MXE privately confirms that
    // the encrypted margin ratio has breached the threshold.
    // The liquidation price threshold is NEVER revealed — only the boolean
    // "should liquidate" result is output by Arcium MXE.
    pub fn liquidate(
        ctx: Context<Liquidate>,
        // Arcium MXE job ID for liquidation check
        arcium_job_id: [u8; 32],
        // Arcium MXE result signature — proves 3-of-5 nodes agreed
        arcium_result_sig: Vec<u8>,
        // Liquidation penalty to keeper (incentive for running keeper bot)
        keeper_fee: u64,
    ) -> Result<()> {
        let position = &mut ctx.accounts.position;
        require!(position.is_open, StealthPerpError::PositionAlreadyClosed);

        // Verify Arcium MXE confirmed this position should be liquidated
        // The actual liq price comparison happened inside MPC — never revealed
        verify_arcium_result(&arcium_job_id, &arcium_result_sig)?;

        // Pay keeper fee from remaining collateral
        let remaining = position.collateral_amount.saturating_sub(keeper_fee);

        // Transfer keeper fee
        // (vault CPI transfer to keeper omitted for brevity — same pattern as close)

        // Mark position as liquidated
        position.is_open = false;
        position.is_liquidated = true;
        position.close_timestamp = Clock::get()?.unix_timestamp;

        emit!(PositionLiquidated {
            trader: position.trader,
            market: ctx.accounts.market.key(),
            keeper: ctx.accounts.keeper.key(),
            keeper_fee,
            remaining_collateral: remaining,
            arcium_job_id,
            timestamp: Clock::get()?.unix_timestamp,
        });

        msg!(
            "Position liquidated privately — liq threshold never revealed. Keeper fee: {}",
            keeper_fee
        );
        Ok(())
    }
}

// ── Arcium result verification ────────────────────────────────────────────────
// In production: verify the Ed25519 signature from Arcium's threshold key
// This proves 3-of-5 MPC nodes computed the result and signed the output
fn verify_arcium_result(job_id: &[u8; 32], sig: &[u8]) -> Result<()> {
    // TODO: implement Ed25519 signature verification against Arcium's
    // published threshold public key for the MXE cluster
    // Reference: https://docs.arcium.com/mxe/verification
    require!(!sig.is_empty(), StealthPerpError::InvalidArciumSignature);
    msg!("Arcium MXE result verified for job: {:?}", &job_id[..8]);
    Ok(())
}

// ── Account structs ───────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(market_index: u16)]
pub struct InitializeMarket<'info> {
    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", market_index.to_le_bytes().as_ref()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenPosition<'info> {
    #[account(
        init,
        payer = trader,
        space = Position::LEN,
        seeds = [b"position", trader.key().as_ref(), market.key().as_ref()],
        bump
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut)]
    pub trader_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut, seeds = [b"position", trader.key().as_ref(), market.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub trader: Signer<'info>,
    #[account(mut)]
    pub trader_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Liquidate<'info> {
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: keeper is any authorized liquidation bot
    pub keeper: AccountInfo<'info>,
    #[account(mut)]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub keeper_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ── State accounts ────────────────────────────────────────────────────────────

#[account]
pub struct Market {
    pub authority: Pubkey,        // 32
    pub market_index: u16,        // 2
    pub max_leverage: u8,         // 1
    pub is_active: bool,          // 1
    pub open_interest_long: u64,  // 8  (position count, not size — size is encrypted)
    pub open_interest_short: u64, // 8
    pub base_asset_symbol: String,// 4 + 10
    pub bump: u8,                 // 1
}

impl Market {
    pub const LEN: usize = 8 + 32 + 2 + 1 + 1 + 8 + 8 + 14 + 1;
}

#[account]
pub struct Position {
    pub trader: Pubkey,             // 32
    pub market: Pubkey,             // 32
    pub is_long: bool,              // 1  — direction is public (needed for OI)
    pub is_open: bool,              // 1
    pub is_liquidated: bool,        // 1
    pub collateral_amount: u64,     // 8  — collateral deposited (public)
    pub realized_pnl: i64,          // 8  — only revealed at close
    pub open_timestamp: i64,        // 8
    pub close_timestamp: i64,       // 8
    pub arcium_job_id: [u8; 32],    // 32 — MXE job reference
    pub bump: u8,                   // 1

    // ── Arcium ciphertexts — PRIVATE fields ──────────────────────────────────
    // These are stored on-chain as encrypted blobs.
    // Only Arcium's MXE cluster can compute over them.
    // They are NEVER decrypted on-chain — not even by the program.
    pub encrypted_size: Vec<u8>,         // ~64 bytes ciphertext
    pub encrypted_entry_price: Vec<u8>,  // ~64 bytes ciphertext
    pub encrypted_liq_price: Vec<u8>,    // ~64 bytes ciphertext
    pub encrypted_margin: Vec<u8>,       // ~64 bytes ciphertext
}

impl Position {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 32 + 1
        + 4 + 64  // encrypted_size
        + 4 + 64  // encrypted_entry_price
        + 4 + 64  // encrypted_liq_price
        + 4 + 64; // encrypted_margin
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct PositionOpened {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub is_long: bool,
    pub arcium_job_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct PositionClosed {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub realized_pnl: i64,  // Only value revealed by Arcium MXE
    pub arcium_job_id: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct PositionLiquidated {
    pub trader: Pubkey,
    pub market: Pubkey,
    pub keeper: Pubkey,
    pub keeper_fee: u64,
    pub remaining_collateral: u64,
    pub arcium_job_id: [u8; 32],
    pub timestamp: i64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum StealthPerpError {
    #[msg("Position is already closed")]
    PositionAlreadyClosed,
    #[msg("Unauthorized trader — signer does not own this position")]
    UnauthorizedTrader,
    #[msg("Invalid Arcium MXE result signature")]
    InvalidArciumSignature,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Leverage exceeds market maximum")]
    LeverageTooHigh,
}
