---
title: "query returned more than 10000 results"
description: "Why eth_getLogs answers -32005 query returned more than 10000 results, how to page around it by hand, and what a nest does instead."
order: 1
checked: 5.24.1 (2026-11-26)
---

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"query returned more than 10000 results. Try with this block range [0x1934111, 0x1934176].","data":{"from":"0x1934111","limit":10000,"to":"0x1934176"}}}
```

That is `rpc.mevblocker.io` answering an `eth_getLogs` for USDC over 9,000 recent Ethereum blocks,
on 2026-11-17. Infura documents the same message and code: `-32005` "query returned more than 10000
results", with a 10,000-result limit and a 10-second query limit per call
([Infura's eth_getLogs reference](https://docs.infura.io/reference/sei/json-rpc-methods/eth_getlogs/)).
Other endpoints use the same words with their own number. Tenderly's public gateway answered the same
request with `-32602 "invalid params"` and put `Query returned more than 20000 results. Try with this
block range [0x1934111, 0x193524e].` in `error.data`.

## Why it happens

The cap counts logs, not blocks. A busy contract fills 10,000 logs in a few dozen blocks; MEV
Blocker's suggested range above is 102 blocks. A quiet contract never meets it. So a block range that
works for one contract fails for another on the same endpoint, and the same range fails later as the
contract gets busier.

## The fix without Nuthatch

Ask for less per call and walk the range:

1. Filter by `address` and, where you can, `topics[0]`, so only the logs you want count towards the cap.
2. Ask for a block window, and when the error comes back, retry the range the provider names if it
   gives one (the `[from, to]` in the message or in `data`), otherwise halve the window.
3. After the narrower range succeeds, carry on from the block after it, and let the window grow again
   on quiet stretches.
4. Keep what you fetched, keyed by `(transactionHash, logIndex)`, so a retry or a restart does not
   fetch it twice.

A single block can hold more logs than the cap. No range fixes that; it needs a provider with a higher
cap or your own node.

## What a nest does

A nest's backfill is that loop, already written. Each `eth_getLogs` window aims at about 2,000 logs.
When an endpoint refuses a window with this message, `nuthatch dev` halves it and asks again from the
same block until it is served. A `--seal-direct` backfill splits the refused range instead, at the end
of the provider's suggested range when the message names one that starts where the request did, at
the midpoint otherwise. Either way the width that was served becomes the window's ceiling, and a
doubled ceiling is tried again after four windows served whole at it. Rows are keyed by block
and log index, so a retried range writes nothing twice. A single block over the cap stops the backfill
with `block N alone exceeds the provider's getLogs result cap - use a provider with a higher/no cap`
rather than retrying it forever.

To see the cap before a backfill meets it, probe the endpoint with the contract you mean to index:

```text
$ nuthatch doctor --rpc https://rpc.mevblocker.io --address 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
rpc.mevblocker.io
  getLogs window   up to 80 blocks (recommend --window 40)
  JSON-RPC batch   200+ (fine)
  archive depth    yes (state) - pinned eth_call works; old logs not established, so a from-genesis backfill is not proven
```

Or index it and let the window find the cap itself. This run asked Tenderly's keyless gateway for
3,000-block windows of USDC, on nuthatch 5.22.0, 2026-11-17:

```sh
nuthatch init 0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48 --chain mainnet \
  --rpc https://gateway.tenderly.co/public/mainnet --dir usdc
nuthatch dev --dir usdc --backfill 3000 --window 3000
```

Within a minute it had read 2,667 of the 3,000 blocks without stopping on the cap; after that the
gateway's rate limit set the pace. `/ready` showed the window it had settled on,
`"fetch_window_blocks":18`, and the rows were there, each log once:

```text
$ nuthatch sql --dir usdc 'SELECT count(*) AS transfers, min(block_number) AS first_block, max(block_number) AS last_block FROM fiat_token_v2_2__transfer'
 transfers | first_block | last_block
-----------+-------------+------------
 237191    | 26433683    | 26436313
(1 row)
```

`init` names the tables after the contract (`fiat_token_v2_2`, from USDC's implementation) and
writes them all to `schema.json`; `nuthatch sql` with no query opens a prompt where `.tables` lists
them. The
[Quickstart](/docs/start/quickstart/) has the whole path, and
[Troubleshooting](/docs/operate/troubleshooting/) covers a backfill that stalls.
