---
title: "exceed maximum block range: 10000"
description: "Block-range limits on eth_getLogs from public RPCs, with the exact messages measured, the manual chunking fix, and what a nest does."
order: 3
checked: 5.22.0 (2026-11-17)
---

```json
{"jsonrpc":"2.0","error":{"code":-32701,"message":"exceed maximum block range: 10000"},"id":1}
```

That is `polygon-bor-rpc.publicnode.com` answering an `eth_getLogs` over 20,001 Polygon blocks, on
2026-11-17. Most public endpoints refuse a wide range; each says so in its own words, with its own
number. The same request, sent to other keyless endpoints the same day:

| Endpoint | HTTP | Message |
|---|---|---|
| `eth.drpc.org`, `polygon.drpc.org` | 400 | `ranges over 10000 blocks are not supported on free plan` |
| `mainnet.optimism.io`, `rpc.berachain.com` | 413 | `eth_getLogs is limited to a 10,000 range` |
| `rpc.linea.build` | 200 | `range 20000 exceeds limit of 10000` |
| `rpc.mantle.xyz` | 400 | `block range greater than 10000 max` |
| `forno.celo.org` | 400 | `query exceeds range, retry smaller (max block range 5000, got 20000)` |
| `rpc.flashbots.net` | 400 | `block range greater than 2000 max` |
| `mainnet.unichain.org` | 400 | `block range greater than 1000 max` |
| `rpc.hyperliquid.xyz/evm` | 200 | `query exceeds max block range 1000` |
| `cloudflare-eth.com` | 200 | `Invalid eth_getLogs request. 'fromBlock'-'toBlock' range too large. Max range: 800` |
| `api.avax.network` | 200 | `block range too large: total block range in this request exceeds the maximum of 100 blocks` |
| `1rpc.io/eth`, `1rpc.io/bnb` | 200 | `eth_getLogs is limited to 0 - 50 blocks range` |
| `eth-pokt.nodies.app` | 200 | `Block range too large: maximum allowed is 50 blocks on your current plan. …` |

Arbitrum's, Base's publicnode, Gnosis's, Scroll's, zkSync Era's, Zora's and Sonic's public endpoints
answered the same 20,001-block request. These are one day's answers from keyless tiers; a provider can
change its limit, and a paid plan usually has a wider one.

## Why it happens

`eth_getLogs` over a range makes the node walk every block in it, whether or not any log matches. A
shared public endpoint bounds that work per call by capping the span. Unlike a result cap, a range cap
does not depend on the contract: an empty range is refused just the same.

## The fix without Nuthatch

Walk the history in windows no wider than the limit. Take the number from the message, or measure it,
and ask for `[from, from + limit - 1]`, then the next window, until you reach the block you want.
Persist the last block you finished so a restart resumes rather than starting again, and pace the
calls: a public endpoint that serves 50 blocks a call will also rate-limit a loop that asks hundreds of
times a minute.

Start from the contract's deployment block, not block 0. A contract deployed last year has nothing to
find in the years before it, and on a 2,000-block limit that is thousands of empty calls.

## What a nest does

nuthatch reads every message in the table above as a range too large; its test suite holds each of
them, as answered on the day, to that. A refused window is halved and asked again (split, in a
`--seal-direct` backfill), and the width that was served becomes the ceiling for the windows after it,
so the backfill settles at the endpoint's limit without being told it.

Two phrasings measured the same day, `log query range must not exceed 25 blocks`
(`eth.blockrazor.xyz`) and `maximum [from, to] blocks distance: 2000` (`evm.cronos.org`), are
narrowed from the release after 5.22.0. Up to 5.22.0 nuthatch treats them as a failing endpoint: it
retries the same width, and the backfill can stop on it. On those versions give the backfill a window
under the limit with `--window`, which nuthatch never widens past.

`nuthatch doctor` measures the range limit directly, by doubling the span until the endpoint refuses,
so you need not read it from the message:

```text
$ nuthatch doctor --rpc https://polygon-bor-rpc.publicnode.com --address 0x3c499c542cef5e3811e1192ce70d8cc03d5c3359
polygon-bor-rpc.publicnode.com
  getLogs window   up to 1280 blocks (recommend --window 640)
  JSON-RPC batch   200+ (fine)
  archive depth    no - tip-following only; a from-genesis backfill will fail
  · no state at block 96490612 (~1M behind tip): no configured RPC endpoint keeps blocks this old (https://polygon-bor-rpc.publicnode.com); supply an archive-capable RPC with `--rpc` or `rpc_urls`. Last answer: HTTP 403 Forbidden: {"jsonrpc":"2.0","error":{"code":-32602,"message":"Archive requests require a personal token. Get one at: https://www.allnodes.com/publicnode"},"id":1}
```

With USDC's address the window is 1,280 blocks, well under the 10,000 in the message: the result cap
bites first on a busy contract. The last line is the other limit of a keyless endpoint, history, and
no window size gets round it; a backfill from deployment needs an archive endpoint passed with
`--rpc`. `nuthatch init` finds the deployment block itself, by binary search over `eth_getCode`, so a
nest starts there rather than at block 0. That search needs old state too: on an endpoint without it,
`init` prints `deployment block undetected` and asks for `--start-block`.
