---
title: "Upgrading a nest"
description: "The N-1 resync tax, solved by the runtime rather than by a command you have to remember."
order: 10
checked: 5.19.0 (2026-11-11)
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
wait for the monthly minor (5.1, 5.2), and correctness and security fixes ship immediately. A
correctness fix is not a break: a config that was accepted but silently produced wrong data may be
refused at startup, and a security fix with no compatible form may break a surface
in a patch. The release notes name each one and say what to change. Also not
covered: the off-by-default cargo features `graph`, `folds` and `counter`; the SQL dialect behind
`/sql`; segment hashes across `arrow-rs` versions; the admin UI's HTML; and the `postgres-store`
build's internal schema. The full contract is in the operator guide's
[stability contract](https://github.com/nuthatch-org/nuthatch/blob/main/docs/operators.md#stability-contract).

4.x held the same promise from 4.0.0 to 4.15.2. 5.0.0 broke it twice, both for the WASM layer it
removed, and that is why it is a major version.

## Upgrading to 5.19

Replace the binary and restart. A 5.18 store is used as it is, with no storage migration, and no NID,
registry hash or sealed segment changes. Things to know:

- **An address-history window that has been failing with `timed out` since 5.18.0 is recorded.**
  5.18.0 made a span the provider ran out of time on fail its whole window instead of being asked
  again in halves, so a dense window could be retried at the same width for good. 5.19 narrows it
  again, as 5.17 did.
- **On Gnosis, a watched contract or EIP-7702 delegated account gets its transactions.** `txlist`
  and `txlistinternal` answered `NUTHATCH_UNSUPPORTED` from the first block the account had code. If
  your trace RPC serves `trace_filter`, 5.19 finds them that way instead and backfills from the block
  they were refused at; if it does not, nothing changes. That backfill costs trace calls: Alchemy
  served 20,000 blocks a call on 2026-11-11, the keyless endpoints 100. The other chains read by the
  balance are unchanged.

The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.19.0) have the
measurements.

## Upgrading to 5.18

Replace the binary and restart. A 5.17 store is used as it is, with no storage migration, **with the
exceptions below**. 5.18.0 fixes what a cold audit found and adds no feature, and several of its fixes
change a nest's identity or refuse what used to be accepted. Go straight to 5.18.1 or later: 5.18.0's
engine disagreed with the node on the NID of any nest made by its own `init` or `add`.

**These nests must act.**

- **A nest with an event that has a Solidity `function` parameter must re-index.** The parameter was
  stored as null; it is now the 24 bytes of address and selector, and the nest moves identity so the
  old null rows are refused rather than served beside new ones.
- **A nest whose `chain` the registry does not know, over a `chain_id` it does, is refused at load**,
  naming the registry's chain. Rename `chain` to the name the message gives; that changes the NID.
- **A nest holding a file that is not UTF-8 is refused by name** until the file is removed.

**These nests get a new NID and keep their data.**

- A nest with a row-driven `[[calls]]` declaration: the fields that say what a call reads now feed the
  decode hash. A store is adopted once, with a warning; after that, an edit to what a call reads is
  refused like any other change to what the nest decodes.
- A nest with a `.gitignore`, at any depth: it is no longer hashed. `init` and `add` now write one.
- A nest built with `graph` that has a `checkpoints` directory below its root: only the root one is
  left out now, in every build.

**These are refused where they used to be accepted.**

- `nuthatch add` on a nest that has already indexed. It names both ways on: move `nuthatch.redb` and
  `segments/` aside to re-index, or index the new contract as a nest of its own.
- A live mount that asks for a failover mirror answers 409. Declare the lease in `mounts.toml` and
  restart; a plain mirror still mounts live.
- A `[[factories]]` `child_param` that is not an address parameter of its event.
- `init --from` on a directory holding a symbolic link.

**These behave differently.**

- **Address history says unsupported for a range it will never cover.** A request before
  `start_block` or past `end_block` answers `NUTHATCH_UNSUPPORTED` from 5.18.1 (5.18.0 and earlier
  said `NUTHATCH_INCOMPLETE`). The text after the prefix is unchanged, so a client that reads
  `history starts at block N` needs nothing; one that matches on the prefix should match the new one.
- **Under `isolation = "strict"`, a mount's `/metrics` carries only its own series.** Read the root
  `/metrics` for runtime-wide ones.
- **Verify a release with the workflow and tag pinned**: add
  `--signer-workflow nuthatch-org/nuthatch/.github/workflows/release.yml` and
  `--source-ref refs/tags/<tag>` to `gh attestation verify`.
- **A `getLogs` range with no answer within the client timeout narrows** instead of aborting the
  backfill.
- The `API live on` log line prints the address the node bound (5.18.1).

A failover deployment upgrades writers before followers, as for 5.17. The release notes for
[5.18.0](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.18.0) and
[5.18.1](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.18.1) have the rest, with the issue
behind each line.

## Upgrading to 5.17

Replace the binary and restart. A 5.16 store is used as it is, with no storage migration, and no NID,
registry hash or sealed segment changes: 5.17 seals the same bytes as 5.16. It adds
[answers in Arrow](/docs/reference/http-api/#answers-in-arrow) beside JSON, which stays the default.
Things to know:

- **A failover deployment: upgrade the writers first, then replace and restart each follower.** This
  is the opposite of 5.16's order, and it is only for writers with `[runtime.publish.failover]` or
  `[mounts.publish.failover]`. A 5.17 writer puts its lease fence in the feed's `fence` field where
  5.16 put a local claim count, and a follower refuses any fence below the highest it has seen since it
  started. A follower that followed a writer before that writer's upgrade may therefore refuse it until
  the follower restarts, and restarting it on 5.17 also gives it the corrected check. Writers without
  failover send no fence and are unaffected.
- **A failover writer started while another still renews the lease exits after about 17 seconds**
  at the defaults, naming the holder. Before 5.17 the first writer's lease could lapse while it booted,
  so the second often won the race instead. A host meant to wait and take over sets `standby = true`.
- **Re-index a runtime nest that 5.14.0 to 5.16.0 may have left with missing rows.** On the buffered
  cursor, the default for runtimes since 5.14.0, a nest that was quarantined and re-admitted, or mounted
  on a running runtime, could commit windows fetched while it was absent as empty, and report
  `last_block` at the tip with rows missing and no error. A runtime with more than one nest on a chain
  is the case; a nest that only ever started with its runtime was not affected.
- **Deduplicate webhooks on the nest and `X-Nuthatch-Delivery` together.** The id is per nest, and the
  header is not covered by the signature, which is over the body.
- **A nest that leaves out `rpc_urls`** loads on 5.17, when the run supplies the RPC, and is refused by
  5.16. Do not write one until every host that loads it runs 5.17.
- **A client asking for Arrow from a 5.16 node gets JSON.** Read `Content-Type` before decoding.
- **A directory holding a leftover `.admin-token.<pid>`**, from a `dev` killed on its first start, had
  that file in its NID. It no longer does, so such a directory's NID returns to a clean one's.
- **An `ORDER BY ... LIMIT` over a `UNION ALL` of literal-tagged arms** returned the wrong rows; its
  answers may change, to the correct ones.

Two patches followed, each a binary swap. **5.17.1** writes a filesystem mirror's objects whole (a
reader could catch a half-written one; an `s3://` mirror was never affected) and leaves a query's
spill directory out of a nest's NID, which matters only to a nest run with `HOME` set to its own
directory. **5.17.2** makes `information_schema` reads on a nest with many sealed segments faster and
smaller.

The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.17.0) have the rest.

## Upgrading to 5.16

Replace the binary and restart. A 5.15 store is used as it is, with no storage migration, and no NID,
registry hash or sealed segment changes. 5.16.0 adds [writer failover](/docs/operate/hosting-nests/#writer-failover)
(RFC-0078), off unless a publish table carries `[runtime.publish.failover]` or
`[mounts.publish.failover]`; a runtime without it is the runtime 5.15.0 was, except for these:

- **Upgrade followers before writers.** A 5.16 writer sends two new feed ops, `outbox` and
  `unoutbox`, whenever an alert is enqueued or delivered, and a 5.15 follower cannot read them. A 5.16
  follower reads a 5.15 writer. This is the order the
  [rolling upgrade](#upgrading-a-runtime-without-an-outage) already takes.
- **A store whose ownership another holder has claimed is a terminal fault** for the nest on it,
  quarantined until restart, where it used to be retried on a backoff that failed the same way each
  time. This reaches scaled mode's workers too.
- **Followers hold the alert outbox.** Snapshots carry it and the feed carries its changes, so a
  follower holds it beside the rows and is charged for it.

5.15.0 changed nothing for a binary user: it added the embeddable engine, a separate opt-in artefact.
The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.16.0) have the rest.

## Upgrading to 5.14

Replace the binary and restart. A 5.13 store is used as it is: the hot store's tables, the sealed
segment format and the segment manifest are unchanged, and no NID, registry hash or sealed segment
changes. A lone nest run over a `nuthatch.toml` is unaffected by everything below. Before upgrading a
runtime:

- **The buffered cursor is the default for every runtime cursor.** Each nest on a chain is now its own
  task reading a shared window buffer, and each cursor's admission is charged `window_buffer_mb`
  (64 MiB at the default ceiling), so a runtime packed within 64 MiB of its ceiling starts its last
  mount quarantined. `NUTHATCH_CURSOR_BUFFER=0` (or `off`) restores the shared cursor; that switch is
  kept for 5.14 only.
- **A cursor may write scratch** under `<runtime>/cursors/<chain>/buffer/`, up to four times
  `window_buffer_mb`, emptied at the cursor's start.
- **Tenant reservations follow activity, not mounts.** An idle tenant holds no permit, and a gate
  keeps a reserve of `max(1, sql_permits / 8)` for tenants holding none. At the default two permits a
  tenant beside others still uses one, as in 5.13.
- **`sql_permits` is no longer capped at 16**, and is set by `[runtime] sql_permits` or live, ahead of
  `NUTHATCH_SQL_MAX_CONCURRENCY`. A `PUT /_admin/runtime` lowering `max_rss_mb` below what the
  permits' memory split needs is now `409`.
- **Feed v2 is negotiated.** A 5.14 follower reads v1 from a 5.13 writer, and a 5.13 follower gets v1
  from a 5.14 writer, so a rolling upgrade from 5.13 works followers first, writer last.
- **A mirror is unchanged unless `followers = true`.** Turning it on publishes offchain snapshots and
  deletes folded provisional tails from the mirror.
- **Requests answer from a published snapshot**, so a long query holds the view versions it pinned,
  and their bytes count against the cursor's ceiling until it ends.

The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.14.0) have the rest.

## Upgrading to 5.13

Replace the binary and restart. A 5.12 store is used as it is, with no storage migration and no NID
change. New settings live in `mounts.toml`. 5.12.1 and 5.12.2, both security releases, are included;
take them if you stop at 5.12. Before upgrading a runtime that hosts more than one tenant:

- **Two tenants on one chain share its two default SQL permits, one each**, and a tenant at its share
  gets `429` `tenant_share`, not `503`. (5.14.0 seats only tenants that are querying.)
- **A `/q` named query whose tip copy exceeds 128 MiB is refused.**
- **Boot counts the 120 MB runtime base against each cursor**, as live admission always did. A mount
  that does not fit, or does not build, starts quarantined where the whole boot used to fail;
  `--fail-fast` restores that.
- **The follower feed is new.** 5.12 has no feed, so the upgrade to 5.13 cannot be a rolling one.
- **`string_agg` results are capped at 16 MiB, and computed values count against a statement's
  memory budget.** A statement whose sort or join keeps large computed values may be refused somewhat
  earlier than before, never later.
- **Undecoded logs warn** once per window where they were silent at debug level.

The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.13.0) have the rest.

## Upgrading a runtime without an outage

A runtime alone is down for the length of a restart, because its listener binds only after every
mount is built. With [followers](/docs/operate/hosting-nests/#read-replicas-and-upgrades-without-an-outage)
in front of it (since 5.13.0), roll one process at a time: each follower first, waiting for its
`/<tenant>/<alias>/ready` to say `"writer": "connected"` and `"lag_generations": 0`, then the writer
last. While the writer restarts, the followers answer as of the last block it committed and report
`"writer": "absent"`. `scripts/rolling-upgrade.sh <previous> <current>` in the repository runs exactly
this with a query every 200 ms and fails if any goes unanswered. The first upgrade this works for is
5.13 to 5.14. From 5.15 to 5.16 the order is required, not only convenient: a 5.15 follower cannot
read the feed a 5.16 writer sends.

## Upgrading to 5.11

Replace the binary and restart. A 5.10.0 store is used as it is: no storage migration, and no
existing nest's NID changes. 5.11.0 is a cold audit put right, and several behaviours are stricter:

- **Anything that calls `/_admin`, the lifecycle routes or the control plane without a token gets
  `401`.** There is no token-less localhost access any more. Set `NUTHATCH_ADMIN_TOKEN`, or read
  `<dir>/.admin-token`, which a localhost nest makes on its first start without one. Set
  `NUTHATCH_CONTROL_TOKEN` before starting `nuthatch control`; it refuses to start without it.
- **A nest with a symlinked input file refuses to start.** Replace the link with a copy. A linked
  `segments/` or `nuthatch.redb`, data on another disk, is still fine.
- **A `[[webhooks]]` entry whose `table`, `where` or `since` cannot work refuses the nest.** It used
  to be accepted and never fire. The error names the field.
- **`top` above 1,000 is refused** by `nuthatch diff --top`, `/diff` and the MCP `diff` tool.
- **A nest that declares `[flags] threshold` and backfills with `--seal-direct` now seals a
  `threshold_flag` table**, as the tip path always did. Its NID is unchanged; a dataset sealed before
  keeps its history without flags until re-indexed.

The [release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.11.0) have the rest.

## Upgrading to 5.8

Replace the binary and restart. A 5.7.2 store is used as it is: no storage migration, and no NID or
registry hash changes. Several defaults are stricter, and these need a look first. The names and
the NID spelling below stop a config that loaded on 5.7.2 from loading: each could reach outside the
nest's own directory or give one dataset a second one.

- **The admin token applies on localhost.** With `NUTHATCH_ADMIN_TOKEN` set, every admin request
  must present it, on every bind. Without one, a localhost runtime answers only requests addressed to
  loopback, so behind a proxy that forwards a public `Host`, `/_admin` answers `401` until a token is
  set. (5.11.0 removes that loopback allowance; see above.)
- **Names outside `[A-Za-z0-9_-]` refuse to load.** Check contract aliases and template names in
  deployed nests. A mount named like a runtime route, or a tenant named like a default-tenant alias,
  is refused too.
- **An upper-case NID in `mounts.toml` refuses to load.** Lower-case it. The dataset directory under
  `data/` is already lower case unless it was mounted that way by hand.
- **`pack verify` needs `--pubkey`**, the signer's public key; the key inside the pack is no longer
  trusted.
- **An `open` mount of a nest that ships a `queries.toml` serves within it**, answering the author's
  queries rather than free-form SQL.

A nest that serves `/balances` or `/exposure` should be restarted once on 5.8.0: before it, a restart
rebuilt them from a large batch and kept only its last step, so totals could be wrong. The
[release notes](https://github.com/nuthatch-org/nuthatch/releases/tag/v5.8.0) have the rest.

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

> **What changed.** `nuthatch nest diff` and `nuthatch nest upgrade` were removed in 2.0. They carried real information,
> but only if you remembered to run them. That information now arrives at the moment a nest's identity
> actually changes, which is the moment it matters.

## Stage the new version and migrate

An update is staged by placing the new version's authored nest (its files, not a data directory) at
`<runtime>/nests/<alias>/` on a stopped runtime. `migrate` sees that its identity differs from the
mount's and treats it as an upgrade. With `--dry-run` it prints the plan and names any breaking
change; without it, it applies the plan:

```sh
sudo systemctl stop nuthatch
mkdir -p my-runtime/nests
cp -R usdc-v2 my-runtime/nests/usdc
nuthatch migrate --dir my-runtime --dry-run
nuthatch migrate --dir my-runtime
sudo systemctl start nuthatch
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
produce byte-identical files and hold **one copy** between them. Only byte-identical segments are
shared: a second dataset still keeps its own hot store, and a different event selection, range or
writer version can produce segments of its own.

## What is not being claimed

Authored SQL views are evaluated at request time over the hot and sealed data. A view listed in
`maintained.toml` also keeps a stored copy of that evaluation under `maintained/<view>/`, keyed by a
hash of every input it read, the binary and the authored files included. A view edit or a new binary
changes that key, so the copy is simply not used and a new one is built; it is never part of the
chain-data identity. The reuse above is therefore whole-dataset adoption: it avoids re-fetching raw
chain history when the stored-data inputs are unchanged. It is not per-derivation grafting, which is
not shipped.

A volatile view such as one calling `now()` is legal, but `maintained.toml` refuses it and the answer
cache never keeps it, since its answer depends on more than its inputs. The data-adoption decision does not depend on views,
because no view writes chain data. See [Nest identity & reuse](/docs/concepts/nest-identity/)
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
