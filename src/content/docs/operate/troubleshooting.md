---
title: "Troubleshooting"
description: "RPC failover, stalls, corrupt-segment recovery, and common errors."
order: 13
checked: 5.9.0 (2026-10-23)
---

Symptom → what to look at (`/metrics`) → remedy. All series live on the running `dev`/`runtime` at
`http://127.0.0.1:8288/metrics`; see [Metrics & footprint](/docs/operate/metrics/) for the full
list.

## Is it me or the endpoint?

Before diagnosing anything else, ask the endpoint directly:

```sh
nuthatch doctor --rpc https://your-endpoint.example --address 0xADDR
```

It probes and reports the largest `getLogs` window that endpoint will actually serve, its batch limit,
and whether it has archive history - **measured against that endpoint**, not read from its
documentation, which is frequently wrong and often differs by tier.

Most "backfill is stuck" reports are an endpoint that lacks old history, or one whose real window is a
fraction of its published one. The window shows up here in seconds. History needs more care: doctor
probes old state and the logs at the start of the chain separately, and only `archive depth yes -
deep backfills` means it saw old logs served. `yes (state) ... old logs not established` means
pinned `eth_call` works but a log backfill is unproven, because an empty answer looks the same whether
logs were pruned or never emitted. Neither probe is your deploy block, so before a long backfill, run a
small address-filtered `eth_getLogs` at the block you intend to start from.

## Backfill seems stuck

The most common cause is high `--concurrency` against a **single** RPC endpoint - many concurrent
requests to one host can stall the whole run. Use `--concurrency 1` for one endpoint, or configure
several `rpc_urls` (then 8-16 is fine). Watch `nuthatch_rows_decoded_total` and
`nuthatch_last_block` climb; on a TTY, `dev` shows a live progress line with events/sec and an ETA,
and a frozen line is the concurrency stall above.

A *sparse* contract over millions of blocks isn't stuck, just inefficient - each window comes back
near-empty. Widen it: `--window 50000` turns tens of thousands of near-empty requests into a few.
A window over your provider's `getLogs` cap is not fatal: a refused range is split and the halves
retried, and a refusal that names the range it would serve (`eth_getLogs is limited to 0 - 50 blocks
range`, since 4.11.0) is split there. Only a single block over the cap stops the run (below). Each
split is another request, though, so `nuthatch doctor` (above) gives a window that needs none.

## Free public RPCs: stalls and empty results

nuthatch ships a small pool of free public endpoints per chain so `init` -> `dev` works with no setup.
That is deliberate, and it is the right default for a first run. It is the wrong default for production,
and the failure mode is worth knowing because **it does not always look like an error**:

- **Shared rate limits.** You are queueing behind everyone else on the same free tier from the same IP
  range, so throughput varies by the hour.
- **Silent empties.** A throttled endpoint often answers with an *empty result* instead of an error. To
  the indexer that is indistinguishable from "no logs in this range", so the window advances and you
  simply get less data than expected.
- **Deep backfills crawl or stop.** Full history over a busy contract is millions of `eth_getLogs`
  calls; expect throttling long before it finishes.
- **No archive guarantees.** Many free endpoints prune old state, so a backfill from a 2020 deploy block
  can fail partway. When no endpoint in the pool keeps the blocks asked for, the backfill stops on the
  first refusal and says what to supply, rather than retrying:

  ```text
  Error: backfill cannot fetch blocks 60000000..=60000079
  Caused by:
      no configured RPC endpoint keeps blocks this old (https://bsc-rpc.publicnode.com); supply an
      archive-capable RPC with `--rpc` or `rpc_urls`. Last answer: HTTP 403 Forbidden: ... "Archive
      requests require a personal token. ..."
  ```
- **Address limits.** Some endpoints refuse an `eth_getLogs` that names too many addresses: BSC's and
  Polygon's publicnode refuse ten or more with `Request blocked`, and an address-less one with `Please
  specify an address`. Since 4.11.0 neither is read as a credentials problem. The address list is halved
  until the endpoint accepts it, and the size is remembered (`eth_getLogs naming 10 addresses was
  refused (...); asking in groups of at most 5` in the log), and a factory nest keeps asking by
  address rather than by event signature alone.

**Symptoms:** `nuthatch_last_block` barely moves while `nuthatch_rpc_requests_total` climbs; `/ready`
reports `stalled` (no successful poll within the stall window); the log names each endpoint that
refused the window.

**Remedy - use your own endpoint:**

```sh
nuthatch dev --rpc https://your-endpoint.example/arbitrum
```

`--rpc` is repeatable, and nuthatch round-robins across the pool with per-endpoint health tracking, so
two or three endpoints buy you failover as well as throughput. Persist them as `rpc_urls` in
`nuthatch.toml` rather than passing them every run.

Every endpoint in a pool must be on the **same chain**. nuthatch verifies this at startup and refuses to
run against a mixed pool - indexing against the wrong chain corrupts state silently, so this is a hard
error rather than a warning.

## "block N alone exceeds the provider's getLogs result cap"

One block's logs are too large for the provider to return, and a single block can't be split
further. Use a provider with a higher (or no) result cap. This fails loudly by design rather than
looping forever.

## Tip lag

`nuthatch_tip_lag_blocks` is the gap between the chain head and your last indexed block
(`nuthatch_sealed_through` trails further - past finality, by design). Persistent growth means RPC
throughput, not nuthatch: add endpoints or point at your own node. The adaptive `getLogs` window
self-tunes for density.

## Reorgs

Reorgs only ever touch the **hot store** - sealed segments are immutable, and you should never see
sealed data change. `nuthatch_reorgs_total` counts detections; the hot store rolls back and the IVM
views retract automatically, converging to canonical state. If a plan seems to require rewriting
sealed Parquet to "fix" a reorg, the plan is wrong - the hot store already handled it.

## `/sql` returns 503 or times out

- **503 "server busy"** - the analytical gate is saturated (2 concurrent, after a 250 ms wait). It's
  node self-protection: retry, don't raise the cap.
- **503 naming `sealed_through`** - the unsealed tip is over 2,000,000 rows or 64 MiB of row data
  for one query. This is not load: retrying will not help until the tip seals. Query a block range at
  or below the `sealed_through` the response gives.
- **422 "named query's scan bound"** - a declared query would read more than 512 MiB of source
  bytes, so it was refused unevaluated, with its bound. Narrow its parameters.
- **504, 30 s timeout** - the query is too heavy. Add a `WHERE`/`LIMIT`, aggregate with `GROUP BY`, or
  validate cheaply with [`/explain`](/docs/reference/http-api/) first.
- **Binder and parse errors come back with a fix hint** derived from the real schema: an unknown
  table suggests the nearest real one, a bare `from` suggests double-quoting, `sum(value)` suggests
  `value_dec`. Follow the hint.

## RAM near the 2 GB budget

The budget is per-cursor and CI-enforced; in a runtime it's shared across that cursor's nests
(`max_rss_mb`, default 2048), and a mount projected to exceed it is refused. Check the per-nest
estimated footprint (and the runtime-wide actual `nuthatch_rss_bytes`) in the `/nests` roster. Analytical
sessions over one dataset share one memory pool (`NUTHATCH_BURRMILL_MEMORY_LIMIT`, falling back to
`NUTHATCH_ANALYTICS_MEMORY_LIMIT`), so concurrent queries compete for it rather than each getting
their own; the concurrency gate decides how many run at once. If you're tight, lower query
concurrency rather than the pool.

## "semantic.toml drift" warnings at startup

`semantic.toml` describes a table or column the decode registry doesn't have - a stale edit, or the
ABI changed. Fix the file or run `nuthatch schema` to regenerate the derived artifacts; the
footguns are always recomputed, and only the authored descriptions are yours to maintain. Stale
semantics are worse than none, so `dev` warns loudly.

## "unknown chain" at `init`

`--chain` takes a built-in name, and the error lists every one of them (monad and robinhood included
since 4.11.0):

```text
Error: unknown chain 'avalanche' (try: mainnet, arbitrum-one, base, optimism, polygon, bsc, gnosis,
monad, robinhood) - or pass --rpc <url> to point nuthatch at a chain it doesn't ship built-in
```

For any other EVM chain, pass `--rpc` with an endpoint on it; the chain id is read from the endpoint.

## ABI won't resolve at `init`

`init` tries Sourcify, then keyless Blockscout, then Etherscan if `ETHERSCAN_API_KEY` is set. If all
miss (an unverified contract), pass the ABI directly:

```sh
nuthatch init 0xAddr --abi path/to/abi.json
```

One `--abi` per address, in the same order as the addresses; leave an entry empty to resolve that one
normally. Hardhat and Foundry artifacts work as-is - the ABI is unwrapped from the `"abi"` key.

## The nest indexes nothing and reports no error

Almost always a **proxy whose implementation ABI was never found**. Standard proxies (EIP-1967,
EIP-1822, legacy zeppelinos, and beacon proxies) are followed automatically and resolve to the
implementation's ABI. A protocol using a *bespoke* proxy pattern matches none of those slots, so the
resolvers return the proxy's own ABI - typically two or three administrative events - and every event
you actually wanted is missing. `init` succeeds, the schema looks plausible, and the tables stay empty.

Since **0.7.2**, `init` catches this itself. It samples the contract's real logs and tells you when
none of them match the ABI it resolved:

```
⚠ bonding (0x35Bc…): none of its last 47 log(s) match any event in the resolved ABI.
  As configured this contract will index zero rows, silently.
```

The fix is the implementation's ABI - from the project's repo, or from a block explorer's "read as
proxy" view:

```sh
nuthatch init 0xProxyAddr --abi path/to/implementation.json
```

For a nest you have already scaffolded, overwrite `abis/<alias>.json` and run `nuthatch schema` to
regenerate.

Two things the check will *not* tell you, on purpose. A contract that has emitted no logs recently
proves nothing either way, so it stays quiet rather than crying wolf. And one matching log is enough
to clear it - a contract may legitimately emit events its ABI omits, and only the total mismatch is
the silent failure.
