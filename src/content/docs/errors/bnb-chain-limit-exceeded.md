---
title: "limit exceeded on BNB Chain's public RPC"
description: "Why BNB Chain's public endpoints answer eth_getLogs with -32005 limit exceeded, header not found or an empty array for old blocks, and what to use instead."
order: 5
checked: 5.24.2 (2026-11-27)
---

```json
{"jsonrpc":"2.0","id":1,"error":{"code":-32005,"message":"limit exceeded"}}
```

That is `bsc-dataseed.binance.org` answering an `eth_getLogs` for USDT over three blocks, on
2026-11-17. `bsc-dataseed.bnbchain.org`, `bsc-dataseed2.bnbchain.org`, `bsc-dataseed1.defibit.io`
and `bsc-dataseed1.ninicoin.io` gave the same answer, for three old blocks and for three blocks near
the head alike. The other keyless BNB Chain endpoints answered the same three old blocks (around block
33,554,432) like this:

| Endpoint | Answer |
|---|---|
| `bsc-rpc.publicnode.com` | HTTP 403, `-32602 Archive requests require a personal token. …` |
| `1rpc.io/bnb`, `bsc.blockrazor.xyz` | `-32000 header not found` |
| `bsc.meowrpc.com` | `-32000 The method eth_getLogs is not supported.` |
| `bsc.drpc.org` | HTTP 429, `You reached Public endpoint rate limit, please upgrade to paid plan` |

`bsc-rpc.publicnode.com` did serve recent blocks, and is the only one of these that served an
address-filtered `eth_getLogs` at all.

## Why it happens

BNB Chain makes a block every 0.45 seconds, so its history is long and its logs are many, and the
public endpoints are not archive nodes. BNB Chain's own dataseed nodes refused every `eth_getLogs` we
sent, three blocks included; `limit exceeded` here is a refusal, not a sign that a smaller range would
work.
Others keep only recent history and refuse, or fail to find, anything older.

The quiet failure is worse than the loud ones. A pruned or overloaded node can answer an `eth_getLogs`
for old blocks with `"result":[]`, which is also the correct answer for a range where the contract
emitted nothing. Nothing in the response tells the two apart, so a script carries on with no data and
no error.

## The fix without Nuthatch

Use an endpoint that keeps BNB Chain's history: your own archive node, or a provider plan that
includes archive `eth_getLogs`. Then walk the range in windows it accepts, from the contract's
deployment block.

Do not trust an empty answer from an endpoint you have not checked. Ask it for a range where you know
the contract emitted an event (its deployment block, or the block of a transaction you can see in an
explorer) and confirm the log comes back before you rely on its empty answers elsewhere.

## What a nest does

nuthatch reads `-32005 limit exceeded` as a rate limit: it waits and asks again, and does not narrow
the window, because these endpoints refuse three blocks as readily as three thousand. Probed directly,
the dataseed endpoint shows it cannot carry a nest:

```text
$ nuthatch doctor --rpc https://bsc-dataseed.binance.org --address 0x55d398326f99059ff775485246999027b3197955
bsc-dataseed.binance.org
  getLogs window   FAILED - no probe succeeded
  JSON-RPC batch   100+ (fine)
  archive depth    no - tip-following only; a from-genesis backfill will fail
  · even a 10-block getLogs failed: rpc error: {"code":-32005,"message":"limit exceeded"}
  · a batch of 200 returned 1 results - partial responses are worse than refusals, since a partial timestamp batch seals block_timestamp=0
  · no state at block 133170440 (~1M behind tip): rpc error: {"code":-32000,"message":"missing trie node"}
```

A nest on `--chain bsc` defaults to `bsc-rpc.publicnode.com`, which follows the head and nothing
older: measured in October 2026 it served about 10,000 blocks of history and at most nine addresses
per `eth_getLogs`. A request further back gets its 403, and nuthatch stops the backfill on it with
`no configured RPC endpoint keeps blocks this old`, naming the endpoint and saying to supply an
archive-capable RPC, rather than retrying. A backfill of real history needs your endpoint:

```sh
nuthatch init 0xYourContract --chain bsc --rpc https://your-archive-endpoint.example
nuthatch dev
```

nuthatch cannot tell a false `[]` from a quiet range any better than your script can, and it does not
try. On an endpoint that keeps old state, `nuthatch doctor` also asks for the logs of blocks 1 to 10,
and reports `old logs not established` when the answer is empty rather than counting it as history
served. For your own contract, run the check above against your endpoint before a long backfill.
