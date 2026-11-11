/**
 * SPL Token live demo — Module 05.
 *
 * Follows the demo slide:
 *   1. open the Token Program on the explorer
 *   2. create a mint (6 decimals)
 *   3. create ATAs for two wallets
 *   4. mint 1,000 tokens
 *   5. transfer 250 with TransferChecked
 *   6. burn 50
 *   7. freeze, show a failed transfer, thaw
 *   8. revoke the mint authority
 *
 * Run on devnet:
 *   npm run demo
 *
 * Override the payer or RPC:
 *   PAYER_KEYPAIR=./payer.json RPC_URL=... WS_URL=... npm run demo
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  appendTransactionMessageInstructions,
  assertIsTransactionWithBlockhashLifetime,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  devnet,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  AuthorityType,
  TOKEN_PROGRAM_ADDRESS,
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  getBurnCheckedInstruction,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getFreezeAccountInstruction,
  getInitializeMintInstruction,
  getMintSize,
  getMintToCheckedInstruction,
  getSetAuthorityInstruction,
  getThawAccountInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const WS_URL = process.env.WS_URL ?? "wss://api.devnet.solana.com";

const DECIMALS = 6;
const ONE_TOKEN = 10n ** BigInt(DECIMALS);

const rpc = createSolanaRpc(devnet(RPC_URL));
const rpcSubscriptions = createSolanaRpcSubscriptions(devnet(WS_URL));
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function txLink(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function accountLink(address: string): string {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function shortError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.split("\n")[0] ?? error.message;
  }
  return String(error);
}

function uiAmount(raw: bigint): string {
  const whole = raw / ONE_TOKEN;
  const fraction = (raw % ONE_TOKEN).toString().padStart(DECIMALS, "0");
  return `${whole}.${fraction}`;
}

async function loadPayer(): Promise<KeyPairSigner> {
  const path = process.env.PAYER_KEYPAIR ?? join(homedir(), ".config/solana/id.json");
  const secret = JSON.parse(await readFile(path, "utf8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(secret));
}

/** Build, sign, send, and confirm one transaction. */
async function sendInstructions(
  payer: KeyPairSigner,
  instructions: Instruction[],
): Promise<string> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  await sendAndConfirm(signed, { commitment: "confirmed" });
  return getSignatureFromTransaction(signed);
}

async function printBalance(label: string, ata: Address): Promise<void> {
  const account = await fetchToken(rpc, ata);
  console.log(
    `   ${label}: ${uiAmount(account.data.amount)} tokens (${account.data.amount} raw)`,
  );
}

// ---------------------------------------------------------------------------
// Demo steps
// ---------------------------------------------------------------------------

/** Step 2: create a mint account and initialize it. */
async function createMint(payer: KeyPairSigner): Promise<KeyPairSigner> {
  const mint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rent = await rpc.getMinimumBalanceForRentExemption(space).send();

  // The System Program creates the account and assigns it to the Token Program.
  const createAccount = getCreateAccountInstruction({
    payer,
    newAccount: mint,
    lamports: rent,
    space,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });

  // The Token Program writes decimals and authorities into the new account.
  const initializeMint = getInitializeMintInstruction({
    mint: mint.address,
    decimals: DECIMALS,
    mintAuthority: payer.address,
    freezeAuthority: payer.address,
  });

  const signature = await sendInstructions(payer, [createAccount, initializeMint]);

  console.log("2. Mint created");
  console.log("   mint:", mint.address);
  console.log("   page:", accountLink(mint.address));
  console.log("   tx:  ", txLink(signature));
  return mint;
}

/** Step 3: create the Associated Token Account for one wallet. */
async function createAta(
  payer: KeyPairSigner,
  owner: Address,
  mint: Address,
  label: string,
): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  const instruction = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    owner,
    mint,
  });

  const signature = await sendInstructions(payer, [instruction]);

  console.log(`3. ${label} ATA ready`);
  console.log("   owner:", owner);
  console.log("   ata:  ", ata);
  console.log("   tx:   ", txLink(signature));
  return ata;
}

/** Step 4: mint 1,000 tokens into the payer's ATA. */
async function mintTokens(
  payer: KeyPairSigner,
  mint: Address,
  ata: Address,
): Promise<void> {
  const instruction = getMintToCheckedInstruction({
    mint,
    token: ata,
    mintAuthority: payer,
    amount: 1_000n * ONE_TOKEN,
    decimals: DECIMALS,
  });

  const signature = await sendInstructions(payer, [instruction]);

  console.log("4. Minted 1,000 tokens");
  console.log("   tx:", txLink(signature));
}

/** Low-level transfer used by the normal transfer and the freeze test. */
async function sendTransfer(
  payer: KeyPairSigner,
  mint: Address,
  source: Address,
  destination: Address,
  amount: bigint,
): Promise<string> {
  const instruction = getTransferCheckedInstruction({
    source,
    mint,
    destination,
    authority: payer,
    amount,
    decimals: DECIMALS,
  });

  return sendInstructions(payer, [instruction]);
}

/** Step 5: move 250 tokens with TransferChecked. */
async function transferTokens(
  payer: KeyPairSigner,
  mint: Address,
  source: Address,
  destination: Address,
): Promise<void> {
  const signature = await sendTransfer(
    payer,
    mint,
    source,
    destination,
    250n * ONE_TOKEN,
  );

  console.log("5. Transferred 250 tokens");
  console.log("   tx:", txLink(signature));
}

/** Step 6: burn 50 tokens from the payer's ATA. */
async function burnTokens(
  payer: KeyPairSigner,
  mint: Address,
  ata: Address,
): Promise<void> {
  const instruction = getBurnCheckedInstruction({
    account: ata,
    mint,
    authority: payer,
    amount: 50n * ONE_TOKEN,
    decimals: DECIMALS,
  });

  const signature = await sendInstructions(payer, [instruction]);

  console.log("6. Burned 50 tokens");
  console.log("   tx:", txLink(signature));
}

/** Step 7: freeze, show a failed transfer, thaw, then transfer again. */
async function freezeThaw(
  payer: KeyPairSigner,
  mint: Address,
  source: Address,
  destination: Address,
): Promise<void> {
  const freeze = getFreezeAccountInstruction({
    account: destination,
    mint,
    owner: payer,
  });
  const freezeSignature = await sendInstructions(payer, [freeze]);

  console.log("7. Froze the recipient ATA");
  console.log("   tx:", txLink(freezeSignature));

  try {
    await sendTransfer(payer, mint, source, destination, 10n * ONE_TOKEN);
    console.log("   UNEXPECTED: transfer succeeded while frozen");
  } catch (error) {
    console.log("   transfer while frozen failed as expected");
    console.log("   error:", shortError(error));
  }

  const thaw = getThawAccountInstruction({
    account: destination,
    mint,
    owner: payer,
  });
  const thawSignature = await sendInstructions(payer, [thaw]);
  console.log("   Thawed the recipient ATA");
  console.log("   tx:", txLink(thawSignature));

  const afterThaw = await sendTransfer(
    payer,
    mint,
    source,
    destination,
    10n * ONE_TOKEN,
  );
  console.log("   transfer after thaw succeeded");
  console.log("   tx:", txLink(afterThaw));
}

/** Step 8: remove the mint authority, fixing the supply forever. */
async function revokeMintAuthority(
  payer: KeyPairSigner,
  mint: Address,
): Promise<void> {
  const instruction = getSetAuthorityInstruction({
    owned: mint,
    owner: payer,
    authorityType: AuthorityType.MintTokens,
    newAuthority: null,
  });

  const signature = await sendInstructions(payer, [instruction]);
  const mintAccount = await fetchMint(rpc, mint);

  console.log("8. Mint authority revoked");
  console.log("   tx:       ", txLink(signature));
  console.log("   authority:", mintAccount.data.mintAuthority);
  console.log("   supply:   ", uiAmount(mintAccount.data.supply));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const payer = await loadPayer();
  const balance = await rpc.getBalance(payer.address).send();

  console.log("SPL Token demo — devnet");
  console.log("payer:   ", payer.address);
  console.log("lamports:", balance.value);

  if (balance.value === 0n) {
    throw new Error(
      `Payer has no devnet SOL. Run: solana airdrop 1 ${payer.address} --url devnet`,
    );
  }

  const mint = await createMint(payer);
  const payerAta = await createAta(payer, payer.address, mint.address, "payer");

  const recipient = await generateKeyPairSigner();
  console.log("   recipient:", recipient.address);
  const recipientAta = await createAta(
    payer,
    recipient.address,
    mint.address,
    "recipient",
  );

  await mintTokens(payer, mint.address, payerAta);
  await printBalance("payer", payerAta);
  await printBalance("recipient", recipientAta);

  await transferTokens(payer, mint.address, payerAta, recipientAta);
  await printBalance("payer", payerAta);
  await printBalance("recipient", recipientAta);

  await burnTokens(payer, mint.address, payerAta);
  await printBalance("payer", payerAta);

  await freezeThaw(payer, mint.address, payerAta, recipientAta);
  await printBalance("payer", payerAta);
  await printBalance("recipient", recipientAta);

  await revokeMintAuthority(payer, mint.address);

  console.log("\nDone.");
  console.log("mint:", mint.address);
  console.log("page:", accountLink(mint.address));
}

main().catch((error: unknown) => {
  console.error("\nDemo failed:");
  console.error(shortError(error));
  process.exitCode = 1;
});
