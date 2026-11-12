---
title: "Nest identity & reuse"
description: "How immutable nest versions, mounts, dataset adoption, and shared segments avoid needless re-indexing."
order: 5
checked: 5.20.0 (2026-11-12)
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

What is not authored is not hashed. The hot store, `segments/`, `.admin-token`, `.git`, `.DS_Store`
and a query's `nuthatch-spill-<pid>-<seq>` directory are left out at any depth. So, since 5.18.0, is a
`.gitignore`, which `init` and `add` now write: a nest that had one gets the NID it would have had
without it, and keeps its data. Since 5.18.1 that rule lives in the identity crate, so the embeddable
engine and the nest builder name the nest the node names. The derived directories `maintained`,
`quarantine` and `checkpoints` are left out only at the nest's root, in every build; one of those
names deeper down, such as `abis/checkpoints/`, is an input. Every input must be a regular file and
UTF-8: a symbolic link or a file that is not UTF-8 refuses the nest by name.

The NID deliberately ignores the Nuthatch generator version. A binary upgrade that produces the same
decode registry must not orphan a dataset. The regenerated decoder registry hash remains part of the
manifest, so a binary which actually decodes differently still makes a new NID. 5.18.0 did that
to one kind of nest: an event with a Solidity `function` parameter used to store null and now stores
the 24 bytes of address and selector, so such an event marks the registry hash, the nest moves
identity and it must re-index. Every other nest's registry hash is unchanged.

## The store remembers what decoded it

A store records the decode hash it was indexed under: the event registry folded with every other
declared source of rows, `[[calls]]` among them. `dev` refuses a store whose recorded hash is not the
config's, because continuing would serve old rows under a new reading. `schema.json` carries the same
hash, so the NID moves with it.

Since 5.18.0 the store records identity formula 3, under which a row-driven call's `args`,
`signature`, `on`, `on_any`, `contract_column` and `canonical` feed that hash. Formula 2 could not see
them, so editing one left the hash where it was. A formula-2 store whose hash matches today's config
is adopted once, with a warning: if a call was edited before the upgrade, rows written under the old
reading stay in the table and only a re-index removes them. After that one adoption, an edit to what
a call reads is refused like any other decode change. A sampled declaration keeps its hash.

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
views, entity declarations, `maintained.toml`, `queries.toml`, `semantic.toml`, documentation,
scaffolded agent material, and any hidden file or directory.

When a staged nest has a new NID, the runtime looks across existing runtime datasets. It may adopt one
only when all of the following hold:

- The decoder registry hash matches.
- The data identity matches.
- The candidate contains readable indexed history.

The source data is copied through a staging directory and atomically committed into the new
`data/<nid>/` directory. It is never moved, because the old version or another tenant may still use it.
Only derived state is copied (since 5.11.0), so a file the new version deleted stays deleted, and the
adoption is refused unless the result computes the planned NID.
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

Today's “grafting” is the whole-dataset adoption described above: it removes the needless raw-history
backfill caused by an identity change, and it does not depend on any derived output.

Derived output is handled separately. A view is evaluated at request time over the hot and sealed
data. A view listed in `maintained.toml` also keeps stored copies, each keyed by a hash of every input
it read, so a changed view or binary simply builds a new copy (see
[Maintaining an answer](/docs/book/maintaining-an-answer/)). [Authored entities](/docs/build/entities/)
rebuild locally when the identity changes. Per-derivation DAG reuse across an identity change, grafting
one view's or entity's state onto a new nest, is not shipped.

## Next

- [Run many nests](/docs/operate/many-nests/) - mount records, tenants, and shared cursors
- [Upgrading a nest](/docs/operate/upgrades/) - the operator path for staged updates
- [Storage & sealing](/docs/concepts/storage/) - the hot-store and immutable-segment boundary
