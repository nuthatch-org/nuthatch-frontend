---
title: "The SQL surface"
description: "Querying the hot ∪ cold union, derived columns, and views."
order: 5
checked: 5.8.2
---

One SQL surface spans both stores: the live unsealed tip (redb) and the sealed Parquet history,
registered as one table per event in the query engine,
[Burrmill](https://github.com/nuthatch-org/burrmill) on DataFusion. You never think about the seam - a query over `usdc__transfer` sees every
row from deployment to the block indexed a moment ago. Reach it via `nuthatch sql` (a REPL when
called with no query), `GET /sql`, or the MCP `sql` tool.

## Naming

- Every decoded event is a view named **`{alias}__{event}`** in snake_case: `usdc__transfer`,
  `staking__stake_delegated`. `.tables` in the REPL (or `GET /tables`) lists them.
- Factory children share their template's tables (`{template}__{event}`), distinguished by
  `address`.
- [Authored views](/docs/build/views/) and [recipe](/docs/build/recipes/) derivations appear as
  ordinary views alongside the event tables, described in `/schema` like everything else.

## Columns

Every event table carries the implicit columns `block_number`, `block_hash`, `block_timestamp`,
`tx_hash`, `log_index`, `address` (the emitting contract) and `_seq` (a monotonic per-row ordering
key), plus one column per event parameter.

Two footguns, both machine-tracked in [`semantic.toml`](/docs/build/semantic/):

- **Reserved words.** Solidity loves `from` and `to`. Burrmill accepts a bare `to`, but `from` is
  reserved and must be double-quoted: `SELECT "from", "to" FROM usdc__transfer`. A bare `from` comes
  back with that hint.
- **Big integers.** A `uint256` column like `value` is stored exactly and can't be summed
  directly. Every big-int column gets a derived **`*_dec`** sibling (`value_dec`) for arithmetic:
  `sum(value_dec)`, `value_dec > 1e6`. `_dec` is NULL, and `value_overflow` true, for a value past
  38 digits.

Get either wrong and the error comes back with a fix hint derived from the real schema - the
binder knows the nearest table name, the quoting rule, and the `_dec` convention.

## Semantics & guards

- **SELECT/WITH only.** The surface is read-only by construction; the ingest thread is the single
  writer, and queries only read.
- **One statement per request.** A `;`-stacked second statement is rejected before anything runs.
  This matters more than it looks: `COPY … TO` and `ATTACH` write to disk regardless of the
  in-memory connection, so a stacked statement was a file-write primitive. Fixed in **v0.6.2** -
  see [upgrades](/docs/operate/upgrades/) if you are running anything older.
- **No filesystem access.** Two controls, deliberately with different failure modes. A denylist
  rejects the file-reading functions outright, and since **v0.9.3** an allowlist asks the engine's own
  parser what a statement references and refuses anything unrecognised - a table function must be one
  of three, and a base table must be named like an identifier, which is what catches `FROM
  '/x.parquet'`. The allowlist fails *open* if the parse is unavailable, so it cannot be the only
  control; the denylist is still in front of it.

  Behind them, each Burrmill session opens empty and registers only the tables nuthatch binds: the
  sealed segments and the hot rows. Until 4.1 the engine was DuckDB, whose `allowed_directories` was
  not enforced on the bundled build.

  > **Upgrade to v0.9.3 if you expose `/sql` to anyone you do not trust.** Every earlier release is
  > vulnerable to an arbitrary file read: DuckDB, the engine then, accepted a *quoted* function name, and the denylist
  > matched a forbidden name only when the next character was `(`. `SELECT * FROM "read_csv"('/etc/passwd')`
  > passed both guards and executed. See [upgrades](/docs/operate/upgrades/).
- **Deterministic and finality-aware.** Sealed segments are immutable; only the hot tip can change
  under a reorg, and the union converges with it.
- **Guarded:** a 30-second timeout, a 50,000-row cap, a 64 MiB result-byte ceiling, 2 concurrent
  analytical queries, and a 16 KiB limit on the query text itself. On `/sql` a query cut off by the
  timeout is answered with 504 (400 before 3.12.1). A rejection is the node protecting itself - narrow the query
  rather than fighting the guard. Validate cheaply first with `explain`.
- **Provenance-stamped.** Results carry `as_of` (the block the answer is current to),
  `sealed_through`, `source`, the nest's `nid` and its `registry_hash`, plus each entity's own
  watermark when the query read one, so a number can be cited against a fixed watermark and
  re-derived by anyone. A separate `tip_unavailable` flag says when the hot tail could not be read,
  and since 4.11.0 `source` then says `sealed` rather than `hot+sealed`. The stamp does not list the
  individual segments read.
- **Answers are remembered, never stale.** A repeated statement is answered from a process-local
  cache, marked `"cached": true`. The entry is keyed on what the answer depends on: the statement and
  its row cap, the sealed segments it can read, the hot rows, each entity's watermark and the authored
  files. Since 4.11.0 a cursor poll that commits no new row does not change the key, so a quiet nest at
  the tip answers a repeat from the cache; a committed row, a newly sealed segment or an edited view
  does, and the next request computes. A degraded answer is never remembered. It is bounded by
  `NUTHATCH_SQL_MEMO_BYTES` (64 MiB by default, `0` turns it off) and cleared by a restart.

```sql
-- the shape of a typical answer (block_timestamp is epoch seconds; to_timestamp() makes it a time)
SELECT date_trunc('day', to_timestamp(block_timestamp)) AS day,
       count(*)                                          AS transfers,
       sum(value_dec) / 1e6                              AS volume_usdc
FROM usdc__transfer
WHERE block_number > 20000000
GROUP BY 1 ORDER BY 1 DESC LIMIT 30;
```
