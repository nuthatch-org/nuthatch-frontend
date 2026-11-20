---
title: "Handing a synced subgraph to another indexer, step by step, with waxwing"
date: "2026-11-16"
description: "A hard-to-sync subgraph only needs syncing once. This is the full procedure for dumping a deployment on one Graph indexer and restoring it on another with waxwing, worked through on the Uniswap v4 subgraph on Base: 1.74 billion entities, grafted, and the first deployment of that size waxwing has been pointed at. What each step checks, what it costs, and what has not been measured."
author: "cargopete"
tags: ["waxwing", "indexers", "the-graph", "graph-node", "graphman", "guide"]
draft: false
---

*Indexers keep asking for snapshots of the subgraphs that are painful to sync, so that the second
indexer to serve one does not have to repeat the first one's month. graph-node has been able to
export a deployment since v0.42.0, with `graphman dump`, and to import one, with `graphman
restore`. [waxwing](https://github.com/nuthatch-org/waxwing) sits around those two commands and
makes the result something a receiver can check rather than take on faith. This is the whole
procedure, in order, for anyone who wants to do it today.*

---

## The example is large, and grafted, which is the harder of the two

The worked example throughout is `Qmbsc6XQWbiv4DfLVfaNciScqYLyDWUYjWzrFBbzzmRsMB`, the
[Uniswap v4 subgraph](https://github.com/Uniswap/v4-subgraph) on Base. On 16 November 2026 one
indexer's `/status` reported it synced and healthy at Base block 58,261,086, from a start block of
25,350,987, with **1,740,196,026 entities**. Three indexers held open allocations on it that day.

The size is the obvious problem. The less obvious one is in its manifest: it is grafted onto
`QmS1ehFzXTD9eA1f1EgjZvdyAj2EHtVNMrEN91H3pLuHMy` at block 26,990,278. `graphman restore` looks the
graft base up on the receiving node and fails with `graft_base not found` when it is not there,
which on a fresh indexer it will not be. **`waxwing restore` restores a graft without its base**:
it leaves the graft out of the deployment graphman creates and writes it back into the metadata
once the rows are in.

Everything below uses that hash. Substitute your own.

## What you need on both sides

- graph-node v0.42.0 or later. waxwing has been tested from v0.42.1 to v0.45.0, with publisher
  and receiver on different releases in both directions.
- waxwing itself, which needs Rust 1.88 or later:

  ```sh
  cargo install --git https://github.com/nuthatch-org/waxwing
  ```

- An RPC for the deployment's chain, here Base, that answers `eth_getBlockByNumber` including the
  `finalized` tag. waxwing uses it to check that every dumped head is still canonical.
- On the receiving side, an Arbitrum One RPC, to check the publisher's stake, and access to The
  Graph's IPFS: the dump carries neither the manifest nor the WASM, and graph-node fetches both
  when it starts indexing.

## On the indexer handing it over: dump, seal, cut, attest

**1. Dump it.**

```sh
graphman --config graph-node.toml dump Qmbsc6XQWbiv4DfLVfaNciScqYLyDWUYjWzrFBbzzmRsMB /dumps/univ4-base
```

graph-node's own documentation is candid about this step: the dump runs in **a single
transaction** and "can put significant load on the database for large subgraphs". On a
deployment of this size, choose the hour. Running the same command again later against the same
directory is an incremental dump, which writes only the rows added since, plus small clamp files
for the versions closed since.

**2. Seal it, after every dump.**

```sh
waxwing seal /dumps/univ4-base --rpc <base-rpc>
```

`seal` hashes every file the dump references into `catalogue.json`, records the head the dump was
taken at as a layer, and checks that head against the chain. It also computes a state root, a
hash over every entity version that two honest indexers will agree on even though their Parquet
bytes will not. On Linux `graphman dump` writes as root in the official image, so run `seal` as
the dump's owner or `chown` the directory first. waxwing refuses a directory holding a dump it
never sealed, which is the point: an incremental dump taken across a reorg is accepted by
graphman, because the head number advanced, and restores as a corrupt copy. On the test rig
that meant an entity from the reverted fork and two live versions of another.

**3. Cut it back to a finalized block, and seal the cut.**

```sh
waxwing cut /dumps/univ4-base /dumps/univ4-base-final --at final --rpc <base-rpc>
waxwing seal /dumps/univ4-base-final --rpc <base-rpc>
```

graphman dumps at the chain head, and the head of a live chain is never final. `cut` writes the
dump the deployment would have had at the chain's finalized block: later versions dropped, later
closes undone. The result holds nothing that can be reverted, and it is the thing to publish. The
original stays as it is, ready for the next incremental dump.

**4. Attest to it.**

```sh
waxwing attest /dumps/univ4-base-final --key-file operator.key --indexer <your-indexer-address>
```

This signs the state root at the cut's block, as an Ethereum personal message, with your indexer
key or an operator key you have authorised. `--publish <ipfs-api>` also adds the attestation to
IPFS and prints its CID. A signed state root costs nothing to produce and is the only part of the
handover that says who stands behind the data.

**5. Ship the directory.** waxwing does not care how: `rsync`, object storage, a disk in the post.
The catalogue's root identifies this exact artefact, so the receiver can name what they were given.

## On the indexer receiving it: verify, create, restore, count

**1. Verify it before anything touches Postgres.**

```sh
waxwing verify /dumps/univ4-base-final --rpc <base-rpc> --require-final
```

This re-hashes every file, fails on anything missing, truncated, altered or unlisted, checks
every layer's head is on your own view of the chain, and with `--require-final` fails unless the
head is final there too. It also recomputes the state root from the rows.

**2. Create the subgraph name**, which `restore` needs and the graphman documentation does not
mention:

```sh
graphman --config graph-node.toml create uniswap/v4-base
```

**3. Restore it.**

```sh
waxwing restore /dumps/univ4-base-final \
  --db postgresql://user:pass@host/graph-node \
  --config graph-node.toml --work /dumps/waxwing-work \
  --name uniswap/v4-base --node index_node_0
```

If graphman lives in a container, add `--graphman "docker exec -i <container> graphman"` and
`--work-as` for the path at which the container sees `--work`. On a sharded setup, `--db` is the
shard the deployment is going to and `--primary-db` is the primary.

What happens inside: graphman creates the deployment with no rows, assigned to a node called
`waxwing_parked` that does not exist, so nothing starts indexing it. waxwing drops the default
indexes, loads every chunk with `COPY`, builds the indexes the source actually had, sets the
head, and finally runs `graphman reassign` to hand the deployment to `--node`. On a 3.7 GB test
deployment on 6 October that took **140 seconds against 369 for `graphman restore`** on the same
v0.45.0, with row counts, checksums, head and index count matching the source. If it is
interrupted, run the same command again and it resumes from the last committed batch.

**4. Count who stands behind it.**

```sh
waxwing attested /dumps/univ4-base-final attestation.json --network-rpc <arbitrum-one-rpc>
```

With `--network-rpc`, an attestation only counts if its indexer has tokens provisioned to the
subgraph service and not thawing, and was signed by that indexer or by an operator it authorised.
The answer is a number of distinct staked indexers who agree with this deployment, block and state
root. One is better than none, and the receiver decides what is enough.

**5. Let it index on.** The deployment picks up from the cut's block on its own, with no
restart. Check `/status` until it reaches the chain head.

## The trap that drops a long restore halfway, and why waxwing steps around it

Marc-André Dumas of Ellipfra found this one on a restore that ran past six hours, and filed it as
[graph-node #6752](https://github.com/graphprotocol/graph-node/issues/6752), still open. `graphman
restore` creates the deployment, imports the data, and only then assigns it to a node. For the
whole import the deployment looks unused to graph-node's periodic cleanup job, which records it,
and once `GRAPH_REMOVE_UNUSED_INTERVAL` has passed (360 minutes by default) drops its schema from
under the running restore. **The restore fails on its next insert, six hours in.**

`waxwing restore` assigns the deployment to `waxwing_parked` before the first row is loaded,
which is the workaround the issue itself proposes, so the job should leave it alone. That is a
reading of graph-node's code and the issue, not a reproduction: nobody has yet run a waxwing
restore long enough to meet the job. If you would rather not be the first, raise
`GRAPH_REMOVE_UNUSED_INTERVAL` above your expected restore time anyway. It costs nothing.

## What this has not been tested on, which is anything this big

The largest real deployment waxwing has handed over so far is a Base subgraph of **21,290 entity
versions**, on 6 October. Every check matched, but this example is five orders of magnitude
larger, and several things have simply not been measured at that size:

- **How big the dump is, and how long it takes.** Neither has been measured on this deployment,
  and I would not trust an extrapolation from a 3.7 GB toy.
- **Hashing every row.** `seal` and `verify` read the whole dump to compute the state root, and
  sort on disk once a table passes 256 MB, at 32 bytes a version. At this size that is tens of
  gigabytes of scratch space under `TMPDIR`. `--no-state` skips the state root, at the price of
  having nothing to attest to.
- **`waxwing diff`**, for finding the first block at which two dumps disagree, holds a key per
  version for both sides of a table. It has not been run on a table of a billion rows.
- **Restore speed.** The 2.6 times was two tables of one toy schema. A real deployment's wider
  rows and more indexes may move that ratio either way.

The code has not changed since 6 October. The full record of what was checked, against which
graph-node commit, is in the [README](https://github.com/nuthatch-org/waxwing#readme).

## Try it

If you have a hard deployment synced and are willing to dump it, the five publisher steps above
are an afternoon of typing and an unknown number of hours of waiting. If you run one through,
the [issues](https://github.com/nuthatch-org/waxwing/issues) are open, and a report of the sizes
and times on a real billion-entity deployment would be worth more than anything else that could
be added to this post.
