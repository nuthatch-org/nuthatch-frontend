---
title: Factories
description: Index children a contract spawns at runtime - Uniswap pools, Safe proxies, any factory.
order: 5
checked: 5.6.3
---

Many protocols deploy contracts at runtime: Uniswap's factory spins up a pool per pair, a Safe factory
deploys a proxy per wallet. You can't list those addresses at `init` - they don't exist yet. A
**factory** tells nuthatch to discover them as they're created and index each child automatically.

## The shape

A factory is a **template** (the child's ABI + events) plus a **factory** rule (which event on the
parent announces a new child, and which field holds its address):

```toml
[[templates]]
name = "pool"
abi = "abis/uniswap-v3-pool.json"
# filter = "topic0"        # optional backfill-strategy override for templates with very many children
# events = ["Swap"]        # optional: which of the ABI's events to decode (default: all of them)

[[factories]]
# When `factory` emits PoolCreated, the child in the `pool` param is indexed as a `pool`.
watch = "factory"          # the ALIAS of a [[contracts]] entry (or another template, for nesting)
event = "PoolCreated"
child_param = "pool"       # the event param holding the new child's address
template = "pool"          # which [[templates]] to apply to the child
# start = 12369621         # optional: only honour discoveries at or after this block
```

When the parent emits `PoolCreated`, nuthatch registers the address in that event's `pool` param as a new
`pool` child and decodes its events - every event the template's ABI defines - from discovery onward.

## One table, many children

All children of a template share one set of tables - `pool__swap`, `pool__mint`, `pool__burn` - no matter
how many pools exist. The [implicit `address` column](/docs/build/tables/) tells you which child each row
came from:

```sql
SELECT address AS pool, COUNT(*) AS swaps
FROM pool__swap
GROUP BY 1 ORDER BY swaps DESC;
```

## Discovery is deterministic

Child discovery is part of the deterministic decode path: the same blocks always discover the same
children in the same order, keyed off the parent's events. A reorg that un-emits a `PoolCreated` retracts
that child and its rows along with everything else - factories inherit the same reorg safety as any table
(see [Reorgs](/docs/concepts/reorgs/)).

During a direct backfill, the fetch which reads logs from children discovered in the current chunk
uses the same adaptive narrowing as the ordinary contract fetch. A provider response cap therefore
shrinks the window and retries; it does not abort the factory backfill. This was made consistent in
2.7.0 after a mainnet Uniswap V2 run found the one uncaught path in the field.

## How children are fetched

From 4.11.0 a factory nest asks `eth_getLogs` for the factory's address and its discovered children's
addresses, in the default backfill, the tip loop and a runtime's cursor alike. Past 500 children it
flips to a topic0-only fetch and keeps only the logs a known child emitted, because a very long
address list is slower than discarding non-children locally. `filter = "topic0"` on a template forces
the flip from the start. Before 4.11.0 a factory nest fetched by topic0 alone from the first window.

Public endpoints refuse parts of this, and the fetch adapts rather than failing:

- An endpoint that refuses an address-less `eth_getLogs` switches the cursor to asking by address. On
  `bsc`, whose shipped endpoint refuses it, the nest stays on addresses past 500 children and says so
  at load; `--rpc` at an endpoint that allows topic0-only fetches is cheaper for a large factory.
- An endpoint that refuses too many addresses in one request (publicnode on BSC and Polygon refuses
  ten or more) gets the list in halves until a group is accepted, and the size is remembered. This is
  no longer mistaken for a credentials refusal.

## Runaway factories are bounded

A factory that discovers a vast number of children is exactly the kind of thing that could blow the
[≤2 GB per-cursor budget](/docs/concepts/runtimes/). Discovery is bounded and observable per nest, and in a
[runtime](/docs/operate/many-nests/) its tables and failure state remain isolated. Same-chain nests do
share a cursor, however, so a runaway factory is still a capacity concern for that cursor. The bound
is there to turn that into an observable admission or quarantine decision rather than allowing one
nest to consume the machine by optimism.

## Next

- [ABIs, events &amp; tables](/docs/build/tables/) - the `address` column that distinguishes children
- [Reorgs](/docs/concepts/reorgs/) - how discovered children roll back
- [Recipes](/docs/build/recipes/) - e.g. `reserves` across all discovered pools
