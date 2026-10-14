---
title: Recipes - the eth_call you usually do not need
description: Derive contract reads like totalSupply and getReserves from indexed events - no eth_call, no archive node. When a read is not derivable, pinned calls are there.
order: 6
checked: 5.4.0
---

The Foundation reports that **over 70% of subgraphs call `eth_call`**. But most of those reads aren't
special - they're *derivable* from the events a nest already indexes. Subgraphs fetch them only because
they have no incremental-view engine. **Nuthatch does.**

A **recipe** is an authored SQL view (see [Authored SQL views](/docs/build/views/)) that computes a read
from indexed events instead of fetching it. Deterministic, free, no archive node - and a capability
subgraphs structurally lack, because their storage isn't content-addressed.

:::note
Derive-first is the **default**, not the only option. Since v2.6.0 a nest can also make the call: a
[`[[calls]]` block](/docs/build/contract-calls/) pins a contract read to a fixed block and stores the
result as a table. Reach for a recipe when the value is derivable, because it costs nothing and needs
no archive node. Reach for a pinned call when it is not - an immutable `decimals()`, or a view function
whose inputs were never emitted.
:::

## Use one

```sh
nuthatch recipe list
nuthatch recipe add total_supply     # writes views/total_supply.sql
nuthatch sql "SELECT total_supply FROM usdc_total_supply"
```

`recipe add` drops a `CREATE VIEW` into the nest's `views/`. It's yours to read, edit, or extend - it's
just SQL over your tables.

## The library

| Recipe | Replaces | Derived from |
| --- | --- | --- |
| `total_supply` | ERC-20 `totalSupply()` | Σ minted − Σ burned (Transfers from/to `0x0`) |
| `balances` | `balanceOf(addr)` per address | Σ(in) − Σ(out) per address |
| `holder_count` | - | count of non-zero holders |
| `reserves` | Uniswap-V2 `getReserves()` | the latest `Sync(uint112,uint112)` per pair |

> **Requirements.** `total_supply` / `balances` / `holder_count` need a `Transfer` event whose fields
> are named `from`, `to` and `value`, the ERC-20 convention the views are written against; `reserves`
> needs the pair's `Sync` event. WETH names its fields `src`, `dst` and `wad`, so a recipe added to the
> quickstart's nest fails `nuthatch check` with `no column from` until you rename the columns in the
> view. A nest with several contracts takes `--alias` to say which table. If your nest doesn't index
> the source event yet, add it to `nuthatch.toml` first.

## How `total_supply` works

Under the hood it's just this - Σ minted minus Σ burned, straight over the transfer table:

```sql
CREATE VIEW usdc_total_supply AS
SELECT
    COALESCE(SUM(CASE WHEN lower("from") = '0x0000000000000000000000000000000000000000' THEN TRY_CAST("value" AS HUGEINT) ELSE 0 END), 0)
  - COALESCE(SUM(CASE WHEN lower("to")   = '0x0000000000000000000000000000000000000000' THEN TRY_CAST("value" AS HUGEINT) ELSE 0 END), 0)
    AS total_supply
FROM "usdc__transfer";
```

`reserves` is a window over `Sync` - the current reserves are simply the most recent Sync per pair:

```sql
SELECT address, reserve0, reserve1 FROM (
  SELECT address, reserve0, reserve1,
         ROW_NUMBER() OVER (PARTITION BY address ORDER BY block_number DESC, log_index DESC) AS rn
  FROM "pool__sync"
) WHERE rn = 1;
```

## Derived vs `eth_call`

Every recipe is proven against what the chain's own `eth_call` returns - the derived value is
**byte-for-byte** the fetched one, not merely plausible. Where a read genuinely *can't* be derived (an
oracle price, an ungoverned param), that's the irreducible residue a fallback handles - the derive-first
path here needs **no archive node and no external dependency**. It's the differentiator, and it's the
default.

## What about metadata?

`decimals` / `symbol` / `name` never change, so they're not derived - they're fetched once and cached:

```sh
nuthatch metadata fetch
```

The result lands in `metadata.json`, keyed by address; a cached contract is never re-fetched.
