---
title: Authored incremental entities
description: A bounded keyed relation that Nuthatch maintains as blocks arrive rather than recomputing per query.
order: 4
checked: 5.3.0
---

An entity is a relation a nest elects to maintain while it indexes. Its source facts are still the
decoded event tables, but the answer is updated one block at a time and served by name. This is the
new stable capability in Nuthatch 3.0.0.

Read [authored views](/docs/build/views/) first. The files look similar, but the runtime contract is
not. A view is broad SQL evaluated on demand. An entity is a narrow, keyed incremental computation that
reserves memory continuously. Prefer a view until a real repeated query over growing history needs the
change.

## Declare the relation

Put exactly one `SELECT` in `entities/indexer_rewards.sql`, then describe its identity and bound in
`entities.toml`, beside `nuthatch.toml` in the nest root:

```toml
[[entities]]
name = "indexer_rewards"
sql = "entities/indexer_rewards.sql"
key = ["indexer"]
max_rows = 100000
```

```sql
SELECT indexer, SUM(tokensRewards) AS tokens_rewards
FROM service__indexing_rewards_collected
GROUP BY indexer
```

The name must not collide with a decoded table. The key names output columns and must be unique in the
result. `max_rows` is an admission limit, not an aspiration: exceeding it faults the entity and
quarantines the nest rather than allowing unbounded state to win an argument with the kernel.

## What the SQL may say

The compiler accepts deterministic projection and filtering, exact arithmetic, one `GROUP BY`,
`sum`, `min`, `max`, `avg`, `count`/`count(*)`, and an inner equijoin. It refuses such things as
`ORDER BY`, `LIMIT`, window functions, outer joins, `DISTINCT`, recursive queries and percentile or
other holistic aggregates. Unsupported SQL belongs in a view. It remains useful there, and the refusal
is intentional rather than a missing parser feature.

Every decoded integer, a `uint24` as much as a `uint256`, is read as an exact 128-bit integer. A stored
value too large for that faults the entity rather than wrapping or truncating, even in a row a `WHERE`
would discard, because each row is converted before it is filtered.

## What `check` tells you

`nuthatch check` lowers and binds each entity exactly as `dev` starts it (since 3.13.3), so the two
agree: SQL the compiler refuses, a table or column the nest does not have, and a name that shadows a
decoded table all fail `check`. It also refuses an expression built directly from columns and literals
that must fail on every row, such as `fee + '1'`, `WHERE fee` on an integer, or `SUM` of an address, and
a stored value too large for 128 bits, in sealed history and, when no running nuthatch holds the store,
the hot tail. The expression check is deliberately partial: a refusal is always right, but it does not
look inside `CASE` or `COALESCE`, so some expressions that always fail still pass it. Those, and
anything that depends on the data, fault at runtime, loudly.

An entity with no rows yet is an empty relation of its declared types, so a view over it binds on a
fresh nest, and `check` validates such views the same way.

## What it buys

The Lodestar `indexer_rewards` panel was measured over 733 sealed segments. Its ordinary view took
2.15 seconds at p50; the equivalent maintained entity took 87.7 ms, returning the same 82 rows.
The saving is not magic. The work has moved from every read to each arriving block, where an update of a
309,548-group relation measured 285 microseconds.

Entities appear as relations on `/sql` and can be read through `/derived/{entity}` or a keyed
`/derived/{entity}/{key}` request. They also expose their applied-through watermark, so a caller can
tell what data the answer includes.

## Restarts, reorgs and monitoring

On a restart, Nuthatch rebuilds an entity from the sealed corpus and hot tail already on disk. It does
not fetch history from RPC again. On measured Horizon corpora, seeding 249,979 rows across 733 segments
took 1.9 seconds, and 346,288 rows across 2,985 segments took 2.4 seconds. Adding an `entities.toml`
to an existing nest therefore has a one-off restart cost which should be measured for a latency-sensitive
service.

Reorganised facts enter the same circuit with negative weight, so the relation retracts without an
author-written rollback handler. A fault is terminal and deliberately quarantines the nest: a stale
maintained answer presented as current would be worse than a stopped service.

Scrape the seven per-entity Prometheus series: `nuthatch_entity_applied_through`, `current`, `rows`,
`faulted`, `unavailable`, `seconds_since_progress`, and `state_bytes`, the bytes the entity's circuit
held at its last sample. Add `entity_fault` to an alert sink if the operator needs a push notification
rather than a dashboard discovering it later.

## A limitation that still holds

Since 3.0.0, and still in 4.12.0, `nuthatch dev --seal-direct` refuses a nest that declares an entity
(`--seal-direct cannot be combined with authored incremental entities`). Direct sealing bypasses the ingest
path through which the relation is maintained; completing with an empty entity would be a particularly
polite form of data corruption. Run the normal path for such a nest.

## Next

- [Authored SQL views](/docs/build/views/) - general SQL for questions that are not hot reads
- [Configuration reference](/docs/reference/config/) - all entity and alert fields
- [Metrics & footprint](/docs/operate/metrics/) - scrape and alert on the maintained state
