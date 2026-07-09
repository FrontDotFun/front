#!/usr/bin/env bash
# ──────────────────────────────────────────────
# SCALE PROTOCOL — pool wallet key installer (Robinhood Chain / EVM)
#
# Installs PROTOCOL_WALLET_PRIVATE_KEY on the Railway `api` and
# `workers` services WITHOUT the key ever appearing on screen, in
# shell history, or in any chat/log. Run from the repo root:
#
#   bash scripts/install-evm-key.sh
#
# It will prompt for the key (typing is hidden), validate it, show
# you ONLY the derived public address to confirm, then set it.
# ──────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."

command -v railway >/dev/null || { echo "railway CLI not found — brew install railway"; exit 1; }

# 1. Read key with echo off — nothing is displayed
printf "Paste the EVM private key (0x + 64 hex — input is hidden): "
read -rs KEY
printf "\n"

# 2. Validate format locally
if ! [[ "$KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "❌ Not a valid EVM key. Expected 0x followed by exactly 64 hex characters."
  echo "   (A Solana base58 key cannot be used on Robinhood Chain.)"
  exit 1
fi

# 3. Derive the public address (key goes via stdin, never argv/env)
ADDR=$(printf '%s' "$KEY" | npx tsx --eval '
  import { privateKeyToAccount } from "viem/accounts";
  let data = "";
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => {
    try {
      console.log(privateKeyToAccount(data.trim()).address);
    } catch (e) {
      console.error("DERIVE_FAILED");
      process.exit(1);
    }
  });
')
if [[ "$ADDR" != 0x* ]]; then
  echo "❌ Key failed cryptographic validation — check it and retry."
  exit 1
fi

echo ""
echo "Pool wallet public address: $ADDR"
echo "Explorer: https://robinhoodchain.blockscout.com/address/$ADDR"
printf "Install this key on Railway api + workers? [y/N] "
read -r CONFIRM
[[ "$CONFIRM" == "y" || "$CONFIRM" == "Y" ]] || { echo "Aborted — nothing was set."; exit 0; }

# 4. Set on both Railway services (private key + public address).
#    Railway redeploys the services automatically on variable change.
for SVC in api workers; do
  railway variables --service "$SVC" \
    --set "PROTOCOL_WALLET_PRIVATE_KEY=$KEY" \
    --set "PROTOCOL_WALLET=$ADDR" >/dev/null
  echo "✓ $SVC updated"
done

unset KEY
echo ""
echo "Done. Both services are redeploying with the new key."
echo "Fund the pool by sending ETH on Robinhood Chain to: $ADDR"
