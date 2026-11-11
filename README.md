# SPL Token demo — Module 05

Live demo repo: <https://github.com/deepesh-sr/spl_token_demo_solana>

A minimal, runnable version of the **Token Program walkthrough** slide.

One file: `src/demo.ts`. It creates a fresh token on **devnet**, mints it,
transfers it, burns it, freezes and thaws an account, and revokes the mint
authority. Every step prints an Explorer link.

## What it does

| Slide step | Function | Instruction(s) |
| --- | --- | --- |
| 2. Create mint | `createMint` | System `CreateAccount` + Token `InitializeMint` |
| 3. Create ATAs | `createAta` | Associated Token Account `CreateIdempotent` |
| 3. Two wallets | `main` | payer ATA + fresh recipient ATA |
| 4. Mint 1,000 | `mintTokens` | Token `MintToChecked` |
| 5. Transfer 250 | `transferTokens` | Token `TransferChecked` |
| 6. Burn 50 | `burnTokens` | Token `BurnChecked` |
| 7. Freeze / thaw | `freezeThaw` | `FreezeAccount`, failed transfer, `ThawAccount` |
| 8. Revoke | `revokeMintAuthority` | `SetAuthority(MintTokens, null)` |

The failed transfer in step 7 is **intentional**. It prints
`transfer while frozen failed as expected`, then thaws and transfers again.

## How the code works

`src/demo.ts` is deliberately one file.

- `loadPayer()` reads the Solana CLI keypair and turns it into a Kit signer.
- `sendInstructions()` builds a v0 transaction, sets the fee payer and blockhash,
  signs it, sends it, waits for confirmation, and returns the signature.
- `createMint()` creates the account with the System Program, then initializes
  it with the Token Program.
- `createAta()` derives the Associated Token Account and uses the **idempotent**
  create instruction, so it is safe to call even if the account exists.
- `mintTokens()`, `transferTokens()`, and `burnTokens()` use the **checked**
  variants, which verify the mint and decimals.
- `freezeThaw()` shows the freeze authority at work: transfer fails while the
  destination is frozen, then succeeds after thaw.
- `revokeMintAuthority()` calls `SetAuthority` with `null`, fixing the supply.
- `main()` runs the steps in slide order and prints an Explorer link after each
  transaction.

All amounts are raw integers. `ONE_TOKEN` is `10n ** 6n`, so `1_000` tokens is
`1_000_000_000` raw units.

The only inputs are the payer keypair and the RPC URL. **No private key is stored
in this repository.** The default payer is `~/.config/solana/id.json`.

## Fact-check — November 11, 2026

| Claim | Status |
| --- | --- |
| SPL Token Program ID | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` — correct |
| Token-2022 Program ID | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` — correct |
| ATA Program ID | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL` — correct |
| Mint account is 82 bytes | Correct for the **base SPL Token** mint. Token-2022 mints with extensions are larger. |
| Token account is 165 bytes | Correct for the **base SPL Token** account. Token-2022 accounts with extensions are larger. |
| ATA = PDA of owner + mint + token program | Correct |
| `TransferChecked` is the safe choice | Correct. Plain `Transfer` still exists, but `TransferChecked` checks the mint and decimals. Token-2022 extensions require the checked form. |
| `InitializeMint` vs `InitializeMint2` | Both are valid. `InitializeMint` needs the rent sysvar; `InitializeMint2` does not. This demo uses `InitializeMint` to match the slide. |
| `SetAuthority` with `null` revokes | Correct. No mint authority means fixed supply. |
| Amounts are raw integers | Correct. With 6 decimals, `1_000` tokens = `1_000_000_000` raw units. |

Sources:

- <https://solana.com/docs/tokens/basics/create-mint>
- <https://solana.com/docs/tokens/basics/create-token-account>
- <https://solana.com/docs/tokens/basics/mint-tokens>
- <https://solana.com/docs/tokens/basics/transfer-tokens>
- <https://solana.com/docs/tokens/basics/set-authority>

The demo uses `@solana/kit@8.6.0`, `@solana-program/token@0.18.0`, and
`@solana-program/system@0.16.0`.

## Setup

Requirements: Node 20+ and the Solana CLI.

```bash
npm install
solana config set --url devnet
solana balance
```

If the payer has no devnet SOL:

```bash
solana airdrop 1
```

The demo reads `~/.config/solana/id.json` by default. To use another keypair:

```bash
PAYER_KEYPAIR=./payer.json npm run demo
```

The public devnet RPC can rate-limit. To use a private RPC:

```bash
RPC_URL="<your-devnet-rpc-url>" \
WS_URL="<your-devnet-websocket-url>" \
npm run demo
```

## Run

```bash
npm run demo
```

Or type-check without sending anything:

```bash
npm run typecheck
```

Each run creates a **new mint**, so the addresses and Explorer links are
different every time.

## What to show

1. **Before running**, open the Token Program on Explorer:
   <https://explorer.solana.com/address/TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA?cluster=devnet>
   Point out that it is executable and that thousands of tokens use it.
2. Run the demo and pause after each step.
3. **Mint page** — show supply, decimals 6, mint authority, freeze authority.
4. **Create ATA transaction** — show System Program, Token Program, and
   Associated Token Account Program instructions.
5. **Mint 1,000** — supply is now 1,000.
6. **Transfer 250** — open the recipient ATA; it holds 250.
7. **Burn 50** — supply drops to 950.
8. **Freeze** — transfer fails. Thaw, transfer succeeds.
9. **Revoke** — refresh the mint page: mint authority is `None`; supply is
   fixed at 950.

## Notes

- This is **devnet only**. Do not put a mainnet keypair in this project.
- The recipient is a fresh keypair created at runtime. It only receives tokens;
  it never signs a transaction.
- `decimals` is only for display. The token program always moves raw integers.
- The demo leaves the mint and token accounts on devnet. That is fine; they cost
  only devnet SOL.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Payer has no devnet SOL` | `solana airdrop 1 --url devnet` |
| `429` or RPC timeouts | Use the `RPC_URL` / `WS_URL` override above |
| `Blockhash not found` | Rerun; devnet blockhashes expire |
| `Transaction simulation failed` during step 7 | Expected: the destination is frozen |
| `account already exists` | Rerun; every run creates a fresh mint |
