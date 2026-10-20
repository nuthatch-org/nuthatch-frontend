---
title: Quickstart
description: From a contract address to a live, queryable indexer in under two minutes.
order: 1
checked: 5.8.1
---

This is the golden path: from a bare contract address to a decoded, tip-following, queryable API - on
your own machine, with no external data service.

## 1. Install the binary

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
```

Or build it with cargo, which needs the pinned toolchain - `rust-toolchain.toml` does **not** apply
to `cargo install --git`, so without `+1.95.0` you hit a `dbsp` compiler ICE on rustc 1.97 and get
nothing:

```sh
rustup toolchain install 1.95.0
cargo +1.95.0 install --git https://github.com/nuthatch-org/nuthatch nuthatch
```

## 2. Scaffold a nest from an address

`init` detects the chain, resolves the ABI (Sourcify first, then a keyless Blockscout, then Etherscan
if `ETHERSCAN_API_KEY` is set), vendors it locally, and generates the schema, views, and AI surface -
no API key required for a verified contract.

```sh
nuthatch init 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 --alias weth --chain mainnet
```

You now have a nest directory: `nuthatch.toml`, `abis/`, `schema.json`, `semantic.toml`, `views/`,
`llms.txt` and a `.claude/skills/nuthatch/` skill for a coding agent.

`--alias` is the table prefix, so this contract's events land in `weth__transfer`, `weth__approval`,
and so on. Leave it out and the alias is the contract name from the ABI in snake_case
(`DelegationManager` becomes `delegation_manager`), falling back to `c0` only when the ABI names
nothing usable.

WETH is a plain contract with no proxy, so `init` has nothing to warn about and the decoded history is complete. Contracts behind a proxy get a warning from `init`, because events before the current implementation was deployed may use earlier ABIs this scaffold does not decode.

## 3. Run it

`dev` backfills, follows the tip, decodes every declared event, and serves an HTTP API - all in one
process. It ends by printing `API live on http://127.0.0.1:8288`; try `GET /` and `/metrics` there.

```sh
nuthatch dev --backfill 300
```

`--backfill 300` starts 300 blocks behind the tip, about an hour of mainnet, so there are rows within
seconds. Without the flag `dev` backfills from the contract's deployment block. For WETH that is millions of blocks, a long backfill on free public endpoints and a job for your own RPC. When a from-deployment backfill is long, `init` prints a
`nuthatch dev --backfill N` line under its `next:` hint and `dev` logs the span at cold start.

> **Note - the default endpoints are free public RPCs.** nuthatch ships them so this page works with
> zero setup, and they are fine for trying it out or following a low-traffic contract. They are shared
> and rate-limited, and under load they often return *nothing* rather than an error - so a deep backfill
> will crawl or stall. For anything you care about, point at your own node or a paid provider with
> `--rpc`. See [free public RPCs](/docs/operate/troubleshooting/#free-public-rpcs-stalls-and-empty-results).

## 4. Query it

Point-read an entity, run analytical SQL over the hot tip ∪ sealed history, or read a derived view.

```sh
nuthatch sql 'SELECT dst, wad FROM weth__transfer ORDER BY block_number DESC LIMIT 5'
```

WETH names its `Transfer` fields `src`, `dst` and `wad`, and every decoded column keeps its ABI name.
Most ERC-20s name them `from`, `to` and `value`; `from` is a SQL reserved word, so double-quote it
(`SELECT "from", value …`). nuthatch spots a bare `from` and tells you to quote it rather than just
failing.

…or over HTTP: a SQL count, the top holders (derived, no `eth_call`), and one address:

```sh
curl 'http://127.0.0.1:8288/sql?q=SELECT+count(*)+FROM+weth__transfer'
curl 'http://127.0.0.1:8288/balances?limit=5'
curl http://127.0.0.1:8288/balance/0xSomeHolder
```

Balances are derived from the Transfers you have indexed, so an address answers `no balance` until it
appears in that range - start from `/balances` if you want an address that definitely does.

## What you just got

- **A decoded database.** Every declared event becomes a table `{alias}__{event}`, with implicit
  columns (`block_number`, `tx_hash`, `log_index`, `address`, …) alongside the decoded fields.
- **Hot + cold storage.** A redb tip store for point-reads, sealed content-addressed Parquet past
  finality, unified behind one SQL surface. See [Storage &amp; sealing](/docs/concepts/storage/).
- **Derived state, no `eth_call`.** `nuthatch recipe add total_supply` derives an ERC-20's supply from
  its Transfers, no archive node. The shipped views expect `from`, `to` and `value`, so on WETH's
  `src`, `dst` and `wad` you rename the columns first. See [Recipes](/docs/build/recipes/).
- **An admin UI and metrics** at `/_admin/` and `/metrics`.
- **An MCP server** so an agent can drive it offline. See [MCP](/docs/ai/mcp/).

> **Under two minutes.** That's the whole demo - install, `init`, `dev`, query. Everything after this
> page is about going deeper: authored logic, factories, runtimes, upgrades, and operating it in
> production.

## A word on the free public RPCs

nuthatch ships free public endpoints per chain so that `init` → `dev` works with zero setup. That is
the two-minute demo above, and it is deliberate. They are fine for trying it out, following the tip of
a quiet contract, or a modest recent-history backfill.

They are **not** fine for real work, and it's better to hear that here than at 3am:

- **They are rate-limited and shared.** You queue behind everyone else on the same free tier from the
  same IP range; throughput varies by the hour.
- **They fail intermittently, and not always loudly.** A rate-limited endpoint may return an empty
  result rather than an error. nuthatch fails over across the pool and retries, but a window every
  endpoint refuses will stall - `/ready` reports `stalled` when that happens.
- **Deep backfills will crawl or stop.** Full history over a busy contract is millions of
  `eth_getLogs` calls. Expect a free endpoint to throttle you long before that finishes.
- **No archive guarantees.** Many free endpoints prune old state, so a backfill from a 2020 deploy
  block can fail partway.
- **On Arbitrum, `arb1.arbitrum.io` sends no timestamps on its logs.** Every block's timestamp then
  costs a header, and it takes header batches of about ten, so while it is anywhere in the pool
  (primary or `--rpc-fallback`) every header batch goes out at ten. A backfill through it runs at a
  few times chain speed. For history, use a keyed Arbitrum endpoint *in place of* `arb1`, not beside
  it; `init` and `dev` say this too.

Use your own endpoint for anything you care about - your own node, or a paid provider:

```sh
nuthatch init 0xADDR --chain arbitrum-one --rpc https://your-endpoint.example/arbitrum
nuthatch dev --rpc https://your-endpoint.example/arbitrum
```

Instead of `--rpc` on `dev`, you can set `rpc_urls` in `nuthatch.toml`. `--rpc` is repeatable and
nuthatch round-robins across the pool with per-endpoint health tracking, so listing two or three gets you failover as well as throughput. To keep a paid key behind the free
endpoints instead, give it to `dev --rpc-fallback`: it is asked only while every other endpoint is
failing, so it bills only for what they could not answer. Every endpoint in a pool must be on the
**same chain** - nuthatch verifies this at startup and refuses a mixed pool, since indexing against
the wrong chain corrupts state silently.

## Next

- **[Run it in production](/docs/operate/production/)** - the whole path from a fresh box to a nest
  serving unattended, ending in a pre-flight checklist. Start here if this is going anywhere real.
- **[Deploy it](/docs/operate/deploy/)** - systemd, Docker, and putting a proxy in front.
- **[Performance](/docs/operate/performance/)** - what it measures at, and the three things that
  decide your backfill's wall clock.
- **[Security](/docs/operate/security/)** - read this before exposing `/sql` to anyone you do not trust.
- **[Verifying a deployment](/docs/operate/verifying/)** - prove it works on your own hardware.

- [What is a nest?](/docs/concepts/nests/) - the mental model
- [Build a nest](/docs/build/config/) - `nuthatch.toml`, views, factories, recipes
- [Run many nests](/docs/operate/many-nests/) - one runtime, one or more chains, tenancy included
