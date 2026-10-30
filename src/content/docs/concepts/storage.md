---
title: Storage & sealing
description: A hot redb tip store, content-addressed Parquet sealed past finality, unified behind one SQL surface.
order: 3
checked: 5.14.0 (2026-10-30)
---

Nuthatch stores data in two tiers, split at the finality boundary - and glues them behind one SQL
surface.

## Hot: the redb tip store

Recent, still-reorgable blocks live in an embedded **redb** key-value store - a single table keyed by
`(block_number, log_index)`, each row tagged with the event table it belongs to, so a reorg rollback is
a cheap range-delete above the fork block. This is the mutable tier: it's the *only* place a reorg ever
lands. Entity point-reads (`/entity/{id}`) hit it directly.

## Cold: content-addressed Parquet

Once a block range passes finality (a conservative depth), its rows are **sealed** to an immutable,
**content-addressed** (`sha256`) zstd **Parquet** segment under `segments/`, catalogued in
`manifest.json` with block bounds and row count. Segments sealed before 3.7.0 are Snappy; a nest
holding both serves across the seam. A monotonic `sealed_through` watermark advances so each
range seals exactly once, and the sealed rows are then pruned from the hot store. A table whose
final rows at a cut are under 1,000 rows, under 16 MiB of row JSON and span less than three hours of
chain time, all three at once, is sealed provisionally and folded into its next cut, so a quiet nest
keeps its tip in redb a while before its first segment appears. Rows with no `block_timestamp` skip
the age test and keep the row and byte floors alone.

Because a segment's identity is a hash over its bytes, the same range sealed by the same release produces
the same segment, on any machine, on any run. The bytes include the Parquet writer's version, so a
release that moves the writer can hash identical rows differently; across versions, compare decoded
rows rather than hashes. That's what makes segments *reusable* across nest versions (see
[Upgrading a nest](/docs/operate/upgrades/)) and shareable as a verifiable cache.

> **Sealed is immutable, forever.** Segments are sealed strictly *past finality*, so the columnar layer
> is append-only. If a change would require mutating a sealed segment, the design is wrong - go back. A
> reorg can never reach a sealed segment, by construction.

## The union: one engine over hot ∪ cold

Analytical SQL (`/sql`, `nuthatch sql`) runs on [Burrmill](https://github.com/nuthatch-org/burrmill),
an embedded query engine on DataFusion. Each session registers the sealed segments and the hot tip's
rows as one table per event, so a query spans all of history seamlessly, hot and cold. Only the
ingestion thread writes; queries only read.

Burrmill has been the only engine since 4.1.0. Releases up to 4.0.2 used DuckDB, which is no longer
in the binary; the storage tiers did not change, only the engine reading them. Because sealed segments
are plain Parquet, external readers such as DuckDB or Trino can read them directly. See
[Replacing DuckDB, after all](/blog/replacing-duckdb-after-all).

A point-read for a pruned id transparently falls back to the cold path, so `/entity/{id}` works across
the hot→cold seam without the caller knowing where the row lives.

## Big integers

Values wider than 64 bits (a `uint256`) are stored as an exact decimal string, with a derived
`{col}_dec` DECIMAL column for numeric use. A value over 38 digits exceeds DECIMAL(38,0), and neither
cast rescues it exactly: `HUGEINT` is signed 128-bit and overflows at the same order, and `DOUBLE`
loses precision past about 15 digits. See [The SQL surface](/docs/reference/sql/).

## Next

- [Reorgs &amp; finality](/docs/concepts/reorgs/) - the boundary this split is built on
- [Determinism](/docs/concepts/determinism/) - why content-addressing matters
- [The SQL surface](/docs/reference/sql/) - querying the union
