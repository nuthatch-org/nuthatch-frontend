---
title: "4. Storage and sealing"
description: "Why recent data is mutable, historical data is sealed, and readers see one SQL surface."
order: 5
---

Chain data has an awkward temporal property. The newest blocks must remain reversible because a
reorganisation may replace them. Old blocks ought to be cheap to retain and scan for years. Trying
to satisfy both needs with one storage shape usually produces a database that is rather busy doing
neither particularly well.

Nuthatch separates the two deliberately. The hot store holds the near-tip, reversible working set.
Finalised history is sealed into immutable Parquet segments. The query layer joins the two so a
reader asks one question without having to know whether the answer happened ten minutes or ten
months ago.

## Hot data is for change

The hot store receives decoded rows while the cursor backfills and follows the tip. It supports the
operations a live index needs: inserting new event rows, recording checkpoints, rolling back a
reorganisation and deleting a range that belonged to the discarded branch. It is per dataset,
which gives a nest a clear write boundary and prevents an error in one package from rewriting
another package's working set.

The hot store is not a second-class cache. Before a block has crossed the finality boundary, it is
the authoritative record of what the cursor currently believes the chain says. Its mutability is a
feature. Treating tip data as immutable merely moves the eventual correction into an application
bug, where it is more expensive and less visible.

## Sealing is a commitment

When rows are final enough, Nuthatch writes them to Parquet segments and records them in the
segment catalogue, `segments/manifest.json`. A segment is immutable content with a bounded block
range, table identity and hash; the hash is the SHA-256 of the file's bytes, and it is also in the
file's name, `<table>-<hash>.parquet` in a solo nest. The catalogue describes the set of segments that make up the sealed historical view
and is itself part of the evidence an operator can inspect.

"Final enough" is decided per chain, in the binary's chain table rather than in the nest's
configuration. Ethereum mainnet seals 64 blocks behind the tip; the L2s that serve a `finalized`
tag use it, with a fixed depth to fall back on when an endpoint will not answer; a chain the table
does not know gets 64 blocks. Finality says when a row *may* be sealed, not when it *is*. The
sealer cuts a segment once the finalised rows reach 20,000 or 64 MiB, or once they span the
chain's seal span (1,800 blocks on mainnet), whichever comes first, because a segment per poll
would be a catalogue of crumbs. Until a cut, finalised rows stay in the hot store with the
watermark pinned at a checkpoint, and a finalised range with no rows at all simply advances the
watermark. A cut that leaves a table with fewer than 1,000 rows, under 16 MiB of them, writes a
segment marked provisional, which the table's next seal folds in and replaces; a quiet table is not
condemned to a thousand tiny files. A table that has gone quiet altogether would otherwise hold its
tail provisional for ever, so since 5.7.1 a tail is final once its oldest row is three hours older
than the newest row of the nest's latest seal, even when that seal brought the table nothing. The age is chain time,
read from block timestamps rather than the operator's clock, so two operators still seal identical
files; a table whose rows carry no timestamp has the row and byte rules alone.

The operation is not "move some old rows to a different folder and hope for the best". Each
segment is written to a temporary name, fsynced, renamed into place and its directory fsynced;
only then is the catalogue rewritten the same way and swapped in with one rename. If a process
dies at an inconvenient moment, the previous committed catalogue remains coherent and the orphaned
file is just a file. What this path does not do is read its output back: the hash is computed
from the bytes in memory before they are written. Verification is a separate job, done at every
startup, when each catalogued segment is re-hashed and a damaged one of the nest's own is moved to
`quarantine/`, and on demand by `nuthatch doctor --dir <nest> --catalogue`, which checks without
moving anything. A damaged segment in a runtime's shared store is reported and left where it is,
because other datasets may reference the same bytes; which of them to break is the operator's
decision, not one nest's. Recovery may be boring, which is the highest compliment available to storage
machinery.

Because segments are immutable and named by their content, a runtime keeps them in one shared
store, `segments/<hash>.parquet` beside its datasets, and each dataset's catalogue points into it.
A second nest sealing byte-identical rows finds the file already there. This does not mean every
nest shares every table. It means the runtime can avoid retaining identical sealed history twice
while preserving each dataset's package and query surface. The distinction becomes important
during upgrades.

Content addressing is also what lets sealed history leave the machine. `nuthatch publish` mirrors a
nest's non-provisional segments, schema and catalogue to an object store under its data identity,
and `nuthatch seed` (4.9.0) fills a nest that has never indexed from such a mirror, checking every
file against the hash the catalogue names before installing it. A provisional tail is never in the
published catalogue, since the next seal will replace it, so on its own the mirror would leave a
seed short of each table's newest rows, and short by a different amount for each table. The
publisher therefore also writes a small snapshot beside it, `_seed/`, holding each table's current
tail and an envelope naming the block the whole is complete through. The seed checks the tails as
it checks the segments and resumes at the block after that one. The hashes prove the files are the
ones the catalogue and the snapshot describe. They prove nothing about who wrote them.

## One query surface

Burrmill, the embedded query engine on DataFusion, reads sealed Parquet and the current hot rows
together: each table is the sealed segments unioned with the hot rows above the sealed watermark.
Nuthatch builds a read-only SQL surface over that union; only `SELECT` and `WITH` are admitted. A
query for a block range that straddles the finality boundary does not require the caller to issue
two requests or reconcile duplicate rows. The storage boundary is an implementation detail, albeit
one worth understanding when diagnosing performance. (Burrmill has been the engine since 4.1.0,
released 2026-10-02. DuckDB served from the first release until then, and appears in this book
only as that history.)

There are guards around this freedom. Queries have concurrency, time, row and unsealed-row bounds:
two statements at a time per cursor unless the operator raises it, thirty seconds, 50,000 rows, and
two million hot rows or 64 MiB of them, past which a query is refused rather than quietly answered
from sealed history alone. Since 4.10.0 the engine also counts the memory a scan holds against a
pool the operator sizes, and startup refuses a configuration whose pool, ingestion reservation and
headroom do not fit the cursor's budget, naming the largest value that would. Those guards protect
the node from an enthusiastic analytical query becoming a denial-of-service tool. They do not
provide customer identity, quotas or billing. Those belong at the gateway, where there is actually
an authenticated caller to reason about.

Because an answer is a function of its inputs, a repeated statement can be remembered without ever
being stale. The answer cache keys an entry on what the answer depends on: the statement, the sealed
segments it is served, the generation of the nest's hot rows, each entity's watermark and the
authored files. A committed row or an admitted segment changes the key, and the next request
computes. Up to 4.10.1 the key followed the store's write counter and the seal watermark, both of
which move on every cursor poll; since 4.11.0 it follows the rows and segments themselves, so a nest
that is quiet at the tip answers a repeated statement from the cache. It is bounded by
`NUTHATCH_SQL_MEMO_BYTES` (64 MiB by default, `0` turns it off), and a degraded answer is never
remembered.

## The full life of an event

Take one `Transfer` log. The cursor sees it in a block, selects the ABI decoder and writes a row
with its chain coordinates into the hot store. A reader can now query it, knowing it remains inside
the reorg window. After finality, and once enough finalised rows have gathered for a cut, the
sealer writes the row into a Parquet segment, commits the updated catalogue, and then in one hot
store transaction prunes the corresponding hot copy and advances the sealed watermark. The SQL view
continues to return it, because it reads hot plus sealed history as one logical table.

The row changes physical home exactly once under normal operation. Its meaning does not change at
all. That is the point of keeping decoding separate from storage and of treating finality as a
first-class boundary.

For operational details, see [storage and sealing](/docs/concepts/storage/) and
[reorgs and finality](/docs/concepts/reorgs/). We can now turn to the thing readers actually use:
the index's query surface.
