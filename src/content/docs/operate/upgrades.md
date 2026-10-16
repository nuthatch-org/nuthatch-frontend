---
title: "Upgrading a nest"
description: "The N-1 resync tax, solved by the runtime rather than by a command you have to remember."
order: 10
checked: 5.6.2
---

The N-1 problem is the subgraph resync tax: version N is live, version N+1 needs days of backfill, and
consumers eat downtime or stale data during the flip.

## The 5.x promise

5.x is the stable line. From 5.0.0 to the last 5.x release:

- **Config keeps working.** A config that works on a 5.x release works on every later 5.x release,
  with the same meaning.
- **Data directories upgrade drop-in.** A later 5.x opens a data directory written by an earlier 5.x
  in place. No re-index, no re-seal, no migration command.
- **The HTTP, SQL and MCP surfaces do not break.** No route, response field, generated table or
  column, or MCP tool is removed, renamed or retyped.

The promise is upgrade only; a downgrade is not covered. A released 5.x only gets patches, features
wait for the monthly minor (5.1, 5.2), and correctness and security fixes ship immediately. Also not
covered: the off-by-default cargo features `graph`, `folds` and `counter`; the SQL dialect behind
`/sql`; segment hashes across `arrow-rs` versions; the admin UI's HTML; and the `postgres-store`
build's internal schema. The full contract is in the operator guide's
[stability contract](https://github.com/nuthatch-org/nuthatch/blob/main/docs/operators.md#stability-contract).

4.x held the same promise from 4.0.0 to 4.15.2. 5.0.0 broke it twice, both for the WASM layer it
removed, and that is why it is a major version.

## Upgrading to 5.0

Replace the binary and restart. There is no storage migration and no re-index: 5.0.0 is 4.15.2 with
the WASM transform layer and live screening taken out. Two things can need attention.

- **A `nuthatch.toml` with a `[screening]` table no longer loads.** The error names the table and says
  it was removed. Delete the table and the nest loads; nothing else in the file changes meaning.
- **The `screen_status` MCP tool is gone.** A nest only advertised it when screening was configured.

`nuthatch transform`, `nuthatch screen` and `nuthatch audit replay` are removed, and a compliance pack
manifest with `screening` or `components` entries is refused at `pack verify`. Labels, lists, flags,
exposure, velocity, `audit report` and `audit sealed` are unchanged. A segment sealed by 5.0.0 hashes
differently from the same rows sealed by 4.15, because Parquet 59 writes a different `created_by`
stamp; existing segments are read as they are, and the decoded rows are identical. Compare rows, not
hashes, across versions. The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.0.1)
have the rest.

## Upgrading to 4.11

Replace the binary and restart. There is no storage migration and no re-index: a nest indexed by 4.10.1
resumes at its last block under 4.11.0 and answers the same rows. The one thing to choose is the
download. GraphQL lives only in the `nuthatch-graph-<target>` tarball each release now carries; the
default binary has no GraphQL route and answers `/graphql` with `404`, as it always has. A nest that
serves a subgraph's client queries runs on the graph download, and every other nest needs nothing new.

## Upgrading to 3.0.0

This is a binary swap. Stop the service, replace the binary, and start it again. On-disk state is
forward-readable, `dev` flags are unchanged, and there is no migration or re-index.

For a nest without `entities.toml`, that is the whole upgrade. Production data was counted before and
after the swap on the Lodestar Horizon nest: all 73 tables matched at a pinned watermark, with
2,376,135 rows.

3.0 adds [authored incremental entities](/docs/build/entities/). They are additive, but adding one to
a nest that already has data changes the next restart: Nuthatch seeds the maintained relation from the
sealed corpus and hot tail. It does not make RPC calls or re-index. Measured seeds took 1.9 seconds for
249,979 rows over 733 segments and 2.4 seconds for 346,288 rows over 2,985 segments. Plan that one-off
restart work where a service has a tight availability budget.

An entity-bearing nest must not use `--seal-direct`; 3.0 refuses the combination because direct sealing
bypasses the incremental ingest path. The refusal is intentional. A completed run with an empty entity
would be indistinguishable from a healthy one to far too many dashboards.

The accompanying hardening fixes the release found on real chains: a provider-wide 429 now narrows to a
single block before failing, a backfill that makes no progress fails after 64 attempts, and `/sql`
captures both entity rows and their applied-through watermark under one lock rather than attaching a
newer label to older rows.

Release binaries now carry a GitHub build-provenance attestation as well as a checksum. Verify a manual
download with `gh attestation verify <tarball> --repo nuthatch-org/nuthatch`; the `--repo` clause is
what prevents an attestation from an unrelated repository being accepted.

In 2.0 there is **no upgrade command**. The runtime does the classifying, and grafting does the rest.

:::note[What changed]
`nuthatch nest diff` and `nuthatch nest upgrade` were removed in 2.0. They carried real information,
but only if you remembered to run them. That information now arrives at the moment a nest's identity
actually changes, which is the moment it matters.
:::

## Stage the new version and migrate

```sh
nuthatch migrate --dir my-runtime --dry-run   # prints the plan, and names any breaking change
nuthatch migrate --dir my-runtime             # applies it
```

The runtime compares the staged version's schema against what the alias currently serves:

- **Compatible** - additive only: new tables, new columns, new views. Nothing a current consumer reads
  changes shape. Applied.
- **Breaking** - a consumer-observable change: a removed table or column, a changed type. **Named and
  refused**, with nothing moved:

```text
  usdc: nests/usdc -> data/8f21c4de0b1a
      BREAKING for consumers of `usdc`:
        - column `usdc__transfer.value` removed

Error: 1 mount(s) would break consumers (listed above). Nothing was changed.
```

Add `--allow-breaking` once the consumers are ready, or mount the new version under a different alias
and migrate them across on their own clock. **The data is safe either way** - this is about queries,
not bytes.

## Repoint a name over the admin API

A runtime driven over its admin API changes a name's version without a restart or a file edit. A new
version is a new NID, published to the registry; moving the name to it catches the new nest up beside the
old one and then switches the name's routes in one step, so readers see the old nest, then the new, and
never an error between:

```sh
curl -XPOST localhost:8288/_admin/move/usdc -H "Authorization: Bearer $NUTHATCH_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"nid":"4a71…"}'
```

It is a job, readable at `GET /_admin/mounts/usdc`. A move keeps its chain, and it does not classify
compatibility the way `nuthatch migrate` does: it serves the new identity under the old name. Nor does
it adopt the old dataset: that store is locked while the old nest serves, so the new nest indexes from
its own start (or the runtime's `--backfill`) beside it, and the dataset adoption below is for
`nuthatch migrate` on a stopped runtime. See
[Host nests for others](/docs/operate/hosting-nests/).

## Why an edit usually costs nothing

A nest's identity is a hash of its authored inputs, so *any* edit changes it. Without more, that would
mean every edit re-indexes the chain. Two things stop it:

**Dataset adoption.** A **cosmetic** edit - a comment, a renamed view, a doc change, a tweak to the
query surface - changes what the nest *is* but not what it *stores*. The new identity adopts the
existing derived state instead of backfilling. The copy is staged and committed atomically; the source
is retained because another mount may still be using it. On a real 428 MB nest this took about 0.14 s.

**Shared segments.** Sealed segments are content-addressed, so two nests that decode the same contract
produce byte-identical files and hold **one copy** between them. A second nest indexing a contract you
already index costs no new bytes.

## What is not being claimed

Authored SQL views are currently defined at query time over the hot and sealed data. They are not
materialised, so a view edit does not have stored view data to recompute. The reuse above is therefore
whole-dataset adoption: it avoids re-fetching raw chain history when the stored-data inputs are
unchanged.

Nuthatch does inspect views for cycles and for constructs that would be unsafe to cache if they become
materialised. A volatile view such as one calling `now()` is legal today, but it is not evidence that a
future per-derivation cache could reuse that view's output. The current data-adoption decision does not
depend on views because views do not write stored bytes. See [Nest identity & reuse](/docs/concepts/nest-identity/)
for the two boundaries.

## Coming from 1.x

**If you run a single nest - `nuthatch dev --dir <nest>` on a directory with a `nuthatch.toml` - there
is nothing to migrate.** Stop the service, swap the binary, start it. 2.0's layout change is to
*runtime* directories, and a solo nest does not have one. Verified on a production box: two solo nests
upgraded 1.0.2 → 2.0.0 by binary swap, row counts byte-identical before and after, back at tip in
seconds.

`nuthatch migrate` is for a pre-2.0 directory with a **`roost.toml`**, and also for a current runtime
when an updated nest has been staged under an existing alias. A solo nest has neither use for it.

Measured on a real two-nest runtime rather than a fixture:

```text
BEFORE   882 MB   504 parquet files
$ nuthatch migrate --dir /opt/my-runtime
Shared 504 segment(s) into segments/ (504 duplicate copies reclaimed).
real 0m0.259s
AFTER    880 MB   252 parquet files      per-dataset leftovers: 0
```

A quarter of a second, and **nothing re-indexed**. The disk total barely moves because the segments
were only ~4 MB of that 882 MB - the bulk is per-dataset hot stores, which are mutable and
reorg-affected and so cannot be shared. The **file count** is what shows the collapse; nests with more
sealed history save bytes too.

The order for a runtime directory: dry-run against a copy, stop the service, swap the binary, migrate,
start.

What changed, all of it reserved for a major:

- `roost.toml` → `mounts.toml`, `[roost]` → `[runtime]`
- `nuthatch roost dev` → **`nuthatch dev`**; the directory decides what runs
- `nuthatch nest diff` and `nest upgrade` removed - the runtime classifies at the moment identity changes
- on-disk `nests/<name>/` → `data/<nid>/`, plus a shared content-addressed `segments/`
- the `GET /nests` roster field `roost` → `runtime`

`provenance` also gained `nid`, naming *which dataset* answered rather than only how it decoded. That
one is additive - nothing to do.

## The upgrade you will eventually do at 2am

Rehearse it. `nuthatch migrate --dir <copy> --dry-run` against a non-production copy prints the whole
plan, including every breaking change by name, and changes nothing. A plan you have read once is worth
more than a command you have memorised.
