---
title: "No eth_calls in nuthatch: what you derive instead"
description: "Over 70% of subgraphs call eth_call to read contract state. nuthatch's data path makes none, on purpose, and gives you recipes that derive the same values from indexed events, byte-for-byte and free."
date: 2026-07-22
---

> **Superseded, 2026-08-20.** nuthatch 2.6.0 ships pinned `eth_call` and verified IPFS resolution, so
> the central claim of this post is no longer true of the product. The determinism argument below still
> holds and is why the calls are *pinned* and content-addressed rather than ad hoc, and derive-first is
> still the default. See [We said nuthatch would never call a contract. It does
> now.](/blog/closing-the-subgraph-parity-gap) for what changed and why. Kept as written, because a
> project that quietly edits its old positions is harder to trust than one that dates them.



The Foundation's own number: **over 70% of subgraphs call `eth_call`**. They reach out to an archive
node, mid-index, to read contract *state* the event alone doesn't carry, `getReserves`, `totalSupply`,
`balanceOf`, a token's `decimals`, some arbitrary view. It's the single largest feature gap anyone points
at when they compare nuthatch to a subgraph.

So here's the claim we'll spend the rest of the post backing: **nuthatch's data path makes zero
`eth_call`s, and that's a feature, not the gap it looks like.** Most of those 70% aren't reading anything
special. They're fetching a number they could have *derived* from events they already index, and they
fetch it only because a subgraph has no engine that can derive. nuthatch does.

## Why we don't call

An `eth_call` at `latest`, dropped into the indexing path, quietly breaks three things that nuthatch
treats as non-negotiable:

- **Determinism.** The data path has to be re-executable: same inputs at the same block, same output, on
  any machine, on any run. A call to `latest` returns whatever the chain says *right now*, so two runs of
  the same backfill disagree. That alone disqualifies it, because determinism is what makes the rest work.
- **Verifiability.** Because everything is re-executable, you verify a nest by *re-running* it, no TEE, no
  zk proofs. A sealed segment is a `sha256` over its bytes, and determinism is what makes the same range
  hash the same everywhere. Non-deterministic state fetches poison the hash.
- **The archive-node dependency, and the bill.** A per-event `eth_call` during backfill means an archive
  round-trip per event, the dominant cost in a subgraph backfill, and a hard dependency on someone's
  archive endpoint. Deriving the same value from events you're already decoding needs neither.

The reframe is the whole point. Subgraphs `eth_call` because they can't derive; they have no incremental
view engine, so when they need state, they fetch it. nuthatch's DBSP/IVM core was built for exactly this.
We already prove it in the smallest case: **balances are derived** from `Transfer` events, never
`balanceOf`-ed. Once you can derive one read incrementally, most of the "eth_call surface" turns out to be
the same trick.

## What you use instead: recipes

A **recipe** is an authored SQL view that computes a contract read from indexed events instead of fetching
it. Deterministic, free, no archive node. Four ship today, and each one replaces a call:

| Recipe | Replaces | Derived from |
| --- | --- | --- |
| `total_supply` | ERC-20 `totalSupply()` | Σ minted − Σ burned (Transfers from/to `0x0`) |
| `balances` | `balanceOf(addr)` per address | Σ(in) − Σ(out) per address |
| `holder_count` | - | count of non-zero holders |
| `reserves` | Uniswap-V2 `getReserves()` | the latest `Sync` per pair |

Two commands and you're using one; the second writes `views/total_supply.sql`:

```sh
nuthatch recipe list
nuthatch recipe add total_supply
```

`recipe add` drops a `CREATE VIEW` into the nest's `views/`. It's yours: plain SQL over your own tables,
readable and editable, not a compiled mapping you have to trust. `total_supply` is Σ minted minus Σ burned
straight over the transfer table:

```sql
SELECT
    COALESCE(SUM(CASE WHEN lower("from") = '0x0000…0000' THEN TRY_CAST("value" AS HUGEINT) ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN lower("to")   = '0x0000…0000' THEN TRY_CAST("value" AS HUGEINT) ELSE 0 END), 0)
    AS total_supply
FROM "usdc__transfer";
```

And `getReserves`, the read that lets you index most AMMs, is just the most recent `Sync` per pair, a
one-line window function:

```sql
SELECT address, reserve0, reserve1 FROM (
  SELECT address, reserve0, reserve1,
         ROW_NUMBER() OVER (PARTITION BY address ORDER BY block_number DESC, log_index DESC) AS rn
  FROM "pool__sync"
) WHERE rn = 1;
```

No archive node. No round-trip. And because it's an IVM view, reorgs are handled for you as retractions:
the same facts re-fed with negative weight, state converges, you don't write or debug any of it.

## Derived, not just plausible

The obvious worry: is a derived number *actually* the number the contract would return? Every recipe is
gated by a parity test, the derived `total_supply` / `reserves` view is checked against what the chain's
own `eth_call` returns at the same block, on fixed fixtures, and required to match **byte-for-byte**, not
merely look right. A derivation that can't be proven correct doesn't ship as a recipe; it belongs in the
fallback tier below. This is [RFC-0023](https://github.com/nuthatch-org/nuthatch/tree/main/docs/rfcs)
tier 1, and it's the differentiator: where a read is derivable, we skip the archive node entirely. That's
a strict win over fetching, not parity with it.

## The one honest exception: immutable metadata

Some values genuinely aren't in the events. A token's `decimals`, `symbol`, and `name` never appear in a
`Transfer`, and you can't derive them from anything. But they're also **write-once constants**: they never
change. So nuthatch fetches them exactly once and caches forever, in `metadata.json`, keyed by address,
and never re-fetches them:

```sh
nuthatch metadata fetch
```

Yes, that fetch uses `eth_call` under the hood, this is the one place a plain call is fine. It reads
*metadata*, not data feeding entity derivation; the value is time-invariant, so re-execution stays stable;
and a cached entry is never called again. That's RFC-0023 tier 2. It's the second-biggest chunk of the
"eth_call noise" in a subgraph, removed for the cost of one call per constant.

(For completeness: nuthatch also uses `eth_call` at *init* time, to resolve a proxy's implementation and
introspect an ABI. That's setup, at `latest`, before any indexing, and a test asserts no data-path code
path ever calls `latest`. The stored state stays pure.)

## The irreducible residue, honestly

That leaves the genuinely non-derivable: an oracle price, an ungoverned parameter, a view on a contract
you don't have full event coverage of. For that, RFC-0023 designs a **tier 3 fallback**, a batched
`eth_call` at a *pinned historical block*, run host-side and sealed into segments like any other decoded
fact. Determinism holds because the block is pinned: `result = f(code, storage, block, calldata)`,
re-executable byte-for-byte, EIP-1898 style, never `latest`. Tier 4 goes further, a shared verifiable
cache where one operator produces a range once and others pull the sealed segments instead of re-running
millions of calls, optional and spot-checkable by re-execution, never a dependency.

To be straight about status: **tiers 1 and 2 ship today**, the recipe library and the metadata cache, and
they need no archive node, which is why they're the zero-dependency default. Tiers 3 and 4 are *designed*
(RFC-0023), and the local-execution engine that would run the fallback without any archive RPC at all is
[RFC-0024](https://github.com/nuthatch-org/nuthatch/tree/main/docs/rfcs), still a draft. An operator
only ever needs an archive RPC for the irreducible residue a nest genuinely can't derive, and the recipe
library already covers the common surface for free.

## Try it

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch recipe list
nuthatch recipe add total_supply
nuthatch sql "SELECT total_supply FROM usdc_total_supply"
```

The subgraph answer to "how do I read contract state" is "call an archive node, per event, forever." The
nuthatch answer is "you already indexed the events, derive it." Same number, no call, and a data path you
can re-run to prove it.

Be your own indexer.
