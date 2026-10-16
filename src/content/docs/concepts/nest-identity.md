---
title: "Nest identity & reuse"
description: "How immutable nest versions, mounts, dataset adoption, and shared segments avoid needless re-indexing."
order: 5
checked: 5.7.0
---

A content-addressed nest is deliberately unforgiving: change its authored inputs and it becomes a
new package. That is what lets an operator reproduce exactly how a dataset was decoded. It must not,
however, mean that a documentation correction fetches the entire chain again.

Nuthatch therefore keeps two identities with separate jobs:

```text
authored package ──hashes to──> NID ──mount points to──> data/<nid>/
                                  │
                                  └── data identity decides whether an
                                      existing dataset may be adopted
```

## The NID is the package identity

A nest bundle records every authored file in a canonical manifest: configuration, vendored ABIs,
views, schema, semantic material, and documentation. The **nest identity**, or NID, is a
domain-separated SHA-256 of that manifest.

Any authored edit produces a new NID. That includes a changed ABI, event selection, view, or README.
The old package is not modified in place and a mount cannot silently start meaning something else.

The NID deliberately ignores the Nuthatch generator version. A binary upgrade that produces the same
decode registry must not orphan a dataset. The regenerated decoder registry hash remains part of the
manifest, so a binary which actually decodes differently still makes a new NID.

## Mounts and datasets are different things

The runtime keeps mount records in `mounts.toml`. A mount maps a tenant and friendly alias to a NID;
the dataset itself lives at `data/<nid>/`.

```text
/acme/usdc/sql      ─┐
                     ├── data/<nid>/
/globex/token-feed/ ─┘
```

Aliases and tenants are not part of the dataset identity. Two mounts of the same NID therefore use one
hot store, one backfill, and one dataset. Removing one mount does not remove the data while another
still refers to it. The tenant is an opaque ownership label, not an authentication or billing system;
those concerns belong at the gateway.

## Data identity decides adoption

The NID answers, “is this exactly the same package?” It is intentionally too broad to answer, “would
this package store the same bytes?”

For the latter Nuthatch computes a separate **data identity**. It includes the decode registry and all
authored inputs that can affect indexed data. It excludes only inputs the indexing path cannot read:
views, `queries.toml`, `semantic.toml`, documentation, and scaffolded agent material.

When a staged nest has a new NID, the runtime looks across existing runtime datasets. It may adopt one
only when all of the following hold:

- The decoder registry hash matches.
- The data identity matches.
- The candidate contains readable indexed history.

The source data is copied through a staging directory and atomically committed into the new
`data/<nid>/` directory. It is never moved, because the old version or another tenant may still use it.
If a copy fails, the destination remains input-only and can either retry adoption or backfill normally.

This is why a view-only, query-allowlist, semantic, or documentation change can cost no chain RPC at
all. The package has changed and gets a new NID. Its stored-data inputs have not, so it adopts history.

The conservative direction is important. A missed match costs a backfill. A false match silently
serves the wrong history. Nuthatch does not infer equivalence from similar entity names or similar SQL.

## Shared segments are a second reuse mechanism

Dataset adoption reuses a whole history when the stored-data inputs match. Finalised Parquet is shared
more finely.

In a runtime, sealed segments live in `segments/<content-hash>.parquet`. Dataset manifests refer to
their content hashes. When two nests produce byte-identical segment bytes, they use one physical file.
The segment hash is the proof, so this needs no query-equivalence engine.

Mutable redb hot stores remain per dataset. They have a writer and are affected by reorgs, which makes
them the wrong thing to share. Sealed segments are immutable and are the proper deduplication boundary.

## Updating a nest

Stage the incoming authored package under the alias, inspect the plan, then apply it:

```sh
nuthatch migrate --dir <runtime> --dry-run
nuthatch migrate --dir <runtime>
```

The plan either keeps an existing identity, merges duplicate mounts, adopts a dataset, or creates a
fresh dataset and indexes it. It also compares the incoming `schema.json` with the schema consumers
currently see.

Adding tables or columns is compatible. Removing or renaming them, or changing a column type, is
breaking and is refused by default. Use `--allow-breaking` only once consumers are ready, or mount the
successor under a new alias and migrate callers on their own schedule.

This is a schema-surface check, not a proof of SQL semantics. A view can retain the same columns while
changing their meaning. Review still matters.

## What grafting means today

Views are currently defined at query time over the hot and sealed data. They are not materialised, so a
view edit has no stored view output to recompute. Today's “grafting” is therefore the whole-dataset
adoption described above: it removes the needless raw-history backfill caused by an identity change.

Per-derivation DAG reuse is a later optimisation, for the point at which Nuthatch has materialised
derivations to reuse. A volatile expression such as `now()` is valid in a query-time view, but it is
not evidence that a future materialised cache could safely reuse that view's output.

## Next

- [Run many nests](/docs/operate/many-nests/) - mount records, tenants, and shared cursors
- [Upgrading a nest](/docs/operate/upgrades/) - the operator path for staged updates
- [Storage & sealing](/docs/concepts/storage/) - the hot-store and immutable-segment boundary
