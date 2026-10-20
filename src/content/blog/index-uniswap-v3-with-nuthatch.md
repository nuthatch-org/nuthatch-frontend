---
title: "Index Uniswap V3 yourself: for free, in under an hour, without writing code"
description: "Self-host a full Uniswap V3 index, every pool, every swap, prices and volume, with one Rust binary, one config file, and SQL. No graph-node, no gateway, no query fees."
date: 2026-07-20
---


Here's a claim, and we'll back every word of it: **you can fully index, serve, and query Uniswap V3, or any other web3 protocol, for that matter, on your own machine, for free, in under an hour,
without writing a single line of code.**

Not a hosted service. Not a subgraph you deploy to someone else's network and pay per query to read.
A local index you own: one Rust binary called [nuthatch](https://github.com/nuthatch-org/nuthatch),
one config file, and plain SQL.

## The short version

There's a prebuilt nest for it. Three commands: clone the nest, index a recent slice, and ask it anything:

```sh
nuthatch init --from https://github.com/nuthatch-org/uniswap-v3
nuthatch dev --dir uniswap-v3 --backfill 10000000 --seal-direct
nuthatch sql --dir uniswap-v3
```

You wrote nothing. Point `rpc_urls` at an endpoint you like (more on that below), and a couple of
minutes later you're here:

```sql
SELECT * FROM global;
```

```
 pools | tokens | swaps  | mints | burns | pools_with_swaps
-------+--------+--------+-------+-------+------------------
    88 |     85 | 15,176 |   171 |    75 |               78
```

Eighty-eight pools, fifteen thousand swaps, every one discovered automatically, none of it
hand-configured. Want the busiest pools and how much moved through them?

```sql
SELECT pool, swaps, volume_token0, volume_token1
FROM pool_volume ORDER BY swaps DESC LIMIT 5;
```

That's real volume, the exact on-chain amounts summed in `DECIMAL(38,0)`, the same headline number
the Uniswap subgraph publishes, computed here in four lines of SQL you can read.

## What makes Uniswap the hard case

Most "index a contract" tutorials pick something with a fixed address. Uniswap isn't that. It's a
**factory**: one contract that spawns a brand-new pool contract for every token pair and fee tier,
thousands of them, with new ones born every day. You can't list the addresses up front; they don't
exist yet.

nuthatch handles that with exactly one rule in the config:

```toml
[[templates]]
name = "pool"
abi  = "abis/pool.json"

[[factories]]
watch       = "factory"        # the factory contract…
event       = "PoolCreated"    # …emits this when a pool is born…
child_param = "pool"           # …carrying the new pool's address…
template    = "pool"           # …which we index under the shared pool ABI
```

That's the whole "dynamic data sources" story. At backfill time the indexer watches the factory,
discovers every pool the moment its `PoolCreated` fires, and indexes each one under shared tables
(`pool__swap`, `pool__mint`, …) keyed by the implicit `address` column. In our run it found 1,756
pools on Ethereum and 88 on the Arbitrum slice, with zero per-pool configuration. One rule, every
pool that has ever existed or ever will.

## Building it from scratch (still no code)

If you'd rather build the nest yourself instead of cloning it, here's the whole thing.

**1. Scaffold from the factory address.** `init` resolves the ABI (Sourcify → Etherscan), finds the
deployment block, and writes the config, schema, and a semantic layer:

```sh
nuthatch init 0x1F98431c8aD98523631AE4a59f267346ea31F984 --chain arbitrum-one
```

**2. Grab the pool ABI.** Every V3 pool shares one ABI. Pull it from any pool address:

```sh
nuthatch add 0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8 --dir uniswap-v3
```

**3. Turn the two static contracts into the factory pattern**, move the pool ABI to a `[[template]]`
and add the `[[factories]]` rule shown above, then regenerate the derived schema:

```sh
nuthatch schema --dir uniswap-v3
```

**4. Author the views.** This is where the *meaning* lives, declarative SQL, not imperative handlers.
The pool registry is one statement:

```sql
CREATE VIEW pools AS
SELECT pool, token0, token1, CAST(fee AS INTEGER) AS fee,
       CAST(tickSpacing AS INTEGER) AS tick_spacing, block_number AS created_block
FROM factory__pool_created;
```

Price comes straight out of Uniswap's `sqrtPriceX96` accumulator:

```sql
pow(CAST(sqrtPriceX96 AS DOUBLE) / pow(2, 96), 2) AS price_token1_per_token0
```

And volume, the metric the subgraph is famous (and famously fiddly) for, is a `SUM`:

```sql
CREATE VIEW pool_volume AS
SELECT address AS pool, count(*) AS swaps,
       sum(abs(amount0_dec)) AS volume_token0,
       sum(abs(amount1_dec)) AS volume_token1
FROM pool__swap GROUP BY address;
```

No AssemblyScript. No mapping handlers. No `handleSwap(event)`. Just config and SQL. The whole nest is
TOML + JSON (the ABIs) + SQL, there is genuinely no *program* in it.

## Why this beats deploying a subgraph

A subgraph is a program you write in AssemblyScript, deploy to a network, and then read through a
gateway that meters your queries. nuthatch flips all three:

- **You query with SQL, not a fixed GraphQL schema.** Any question, "pools created this week with more
  than 100 swaps," "the fee-tier distribution" (it's 53 pools at 0.05%, 16 at 0.01%, 14 at 1% here),
  not just the twelve entities someone predefined. There's a built-in MCP server too, so an AI agent
  can drive it directly.
- **It serves itself.** Index → serve API → query, all in the one binary. A subgraph needs graph-node
  + Postgres + IPFS to index and a gateway to serve. nuthatch is `dev` and you're live.
- **You own it, and it's free.** No per-query fees, no API token, no phone-home. It runs in well under
  2 GB of RAM.
- **The logic is legible and auditable.** The pricing is SQL you can read and check, not opaque
  compiled mappings. Reorgs are handled by the engine (retractions, not re-runs), so you don't write,
  or debug, that either.

## "Free", the honest version

The indexer is free. Self-hosting is free (it runs on your laptop). The one thing you bring is an
**RPC endpoint**, and here's the honest guidance, because it's the only place "free" has an asterisk:

- **A free API key is the smooth path.** Alchemy, Infura, QuickNode, and dRPC all have free tiers that
  index a bounded Uniswap slice comfortably. Two minutes to sign up, rock-solid.
- **Bare public URLs work but wobble.** Some serve `getLogs` fine; many rate-limit, 403, or cap block
  ranges. nuthatch fails over across endpoints and retries transient blips, so it rides out the wobble, but a keyed endpoint is calmer.
- **You only pay** if you go *full-history, every-pool-since-launch*, that volume of `getLogs` burns
  through free tiers. A **recent slice** (`--backfill N`) stays free, and that's the under-an-hour path.

## The honest edges

- **Token decimals and USD pricing aren't in the box.** A token's symbol and decimals live behind a
  contract call, and nuthatch's declarative core deliberately doesn't make calls, so amounts and
  prices come out in *raw* units. Join a small vendored token-decimals list to get human values and
  USD. (This is a feature, not a miss: no calls means the index is deterministic and re-runnable.)
  *Update, September 2026: this edge is gone. Since 2.6.0 a `[[calls]]` block makes contract calls
  pinned to a block, sampled or one per event row, and `nuthatch metadata fetch` caches decimals,
  symbol and name. The determinism survived. See
  [We said nuthatch would never call a contract. It does now.](/blog/closing-the-subgraph-parity-gap)*
- **A recent slice, not all of history, by default.** Indexing every pool and swap since the 2021
  launch is a bigger backfill, a paid RPC tier or your own node. The *workflow* is identical; only the
  block range changes.

## Try it

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch init --from https://github.com/nuthatch-org/uniswap-v3
nuthatch dev --dir uniswap-v3 --backfill 10000000 --seal-direct
```

Then `nuthatch sql --dir uniswap-v3` and start asking. Swap the factory address and chain for a
different protocol and the same three moves work, Uniswap is just the gnarliest case to prove it on.

Be your own indexer.
