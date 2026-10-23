---
title: "Your Uniswap V4 subgraph for Robinhood Chain will not deploy to Studio. It will index with nuthatch."
description: "A builder brought us a Uniswap V4 subgraph for Robinhood Chain that built, uploaded, and then failed at the last step with 'network not supported by registrar'. Studio does not index Robinhood Chain yet. Nuthatch has since 3.4. We took the same manifest, pointed it at Robinhood's real V4 contracts, and indexed 52,393 swaps in five minutes on a free endpoint. This is what the error means, what we ran, and what you do and do not get."
date: 2026-09-14
author: "cargopete"
tags: ["nuthatch", "robinhood-chain", "uniswap-v4", "the-graph", "subgraphs", "sql"]
---

*This morning someone in the Night's Watch Discord had a Uniswap V4 subgraph for Robinhood Chain that
built, uploaded to IPFS, and then failed at the final deploy step to Subgraph Studio. Nothing was wrong
with the subgraph. Studio simply does not index that chain yet. This post explains the error, because it
reads like your mistake and is not, and then walks through what we did instead: the same manifest, fed to
nuthatch, indexing Robinhood's live Uniswap V4 contracts on a machine we already had.*

---

## The error, and what it actually says

The deploy fails with this:

```
Could not deploy subgraph on graph-node: network not supported by registrar:
no network robinhood found on chain ethereum
```

It sounds as though you have named the network wrongly. You have not. `robinhood` is the right name, and
it is the one The Graph's own documentation uses.

Both halves of the message come from graph-node. "Network not supported by registrar" means the node
Studio deploys to has no chain configured under that name. "Chain ethereum" is not Ethereum mainnet. It
is graph-node's word for the *family* of chains that speak Ethereum's protocol, which covers every EVM
chain. So the whole sentence means: Studio's node has no EVM chain called `robinhood`.

## Why, when the docs list Robinhood Chain

The Graph does list Robinhood Chain as a supported network, and the per-network page for it exists. What
that page does not show is *which services* the chain is supported for. The
[Supported Networks](https://thegraph.com/docs/en/supported-networks/) table does: Robinhood Chain has
Substreams and Firehose ticked, and the Subgraphs column is empty. The
[networks registry](https://github.com/graphprotocol/networks-registry) says the same thing in data. Its
entry for `robinhood` lists three Substreams and three Firehose providers, and an empty list of subgraph
deploy endpoints, where a chain Studio accepts carries `https://api.studio.thegraph.com/deploy`.

A moderator in the Discord confirmed it within minutes: supported through Substreams, not subgraphs.
Adding subgraph support is a decision for The Graph Foundation, which is taking over Studio and chain
integrations from Edge & Node. It may well come. It is not there today, and no change to your manifest
will get the deploy past that check.

We have written the error up properly, with the evidence, and [Ask Graphy](https://askgraphy.com)
answers from that write-up, so the next person who asks about it finds the answer rather than a
silent channel.

## Nuthatch indexes Robinhood Chain already

Nuthatch is a single binary that indexes a chain into SQL tables on your own machine: no database server,
no Docker, no account, no API key. Robinhood Chain has been built into it since version 3.4. That means
nuthatch carries the chain's id (4663), a public endpoint, a request window sized for how busy the chain
is, and a sealing policy matched to how it finalises. `--chain robinhood` works with no configuration, as
do `robinhood-mainnet`, `robinhood-chain` and `rh`.

It also reads subgraph manifests. `nuthatch init --from-subgraph` takes an IPFS CID or a URL to a
`subgraph.yaml`, and turns every data source into a contract to index. It keeps the addresses and start
blocks, vendors each ABI from the CID the manifest pins, and builds one table per event the subgraph
handles. So a subgraph that Studio will not take is still a perfectly good description of what you wanted
indexed.

## What we ran

We did not have the builder's manifest, so we rebuilt the situation from public parts. Uniswap
[deploys V4 on Robinhood Chain](https://docs.uniswap.org/contracts/v4/deployments): the PoolManager is at
`0x8366a39cc670b4001a1121b8f6a443a643e40951` and the PositionManager at
`0x58daec3116aae6d93017baaea7749052e8a04fa7`. We took the manifest of the Uniswap V4 subgraph for
Ethereum, changed its network to `robinhood` and its two addresses to those, and served the file over
HTTP. That is exactly the shape of a V4 subgraph someone has written for Robinhood Chain.

```sh
nuthatch init --from-subgraph http://127.0.0.1:8765/subgraph.yaml --chain robinhood --no-timestamps --dir v4-robinhood
```

```
→ fetching subgraph manifest http://127.0.0.1:8765/subgraph.yaml…
  ✓ pool_manager         0x8366a39cc670b4001a1121b8f6a443a643e40951  3 event(s)
  ✓ position_manager     0x58daec3116aae6d93017baaea7749052e8a04fa7  3 event(s)

✓ scaffolded nest 'v4-robinhood' from subgraph http://127.0.0.1:8765/subgraph.yaml
    2 contract(s), 0 template(s), 6 table(s) on robinhood
```

Then we ran it against the chain's free public endpoint, asking for the most recent 20,000 blocks:

```sh
nuthatch dev --dir v4-robinhood --backfill 20000
```

It caught up with the tip in 295 seconds, at a little over 200 events a second. Robinhood Chain produces
about ten blocks a second, so that window turned into 22,283 blocks, roughly the last 37 minutes of the
chain:

```sql
SELECT 'swap' t, COUNT(*) n FROM pool_manager__swap
UNION ALL SELECT 'initialize', COUNT(*) FROM pool_manager__initialize
UNION ALL SELECT 'modify_liquidity', COUNT(*) FROM pool_manager__modify_liquidity
UNION ALL SELECT 'position_transfer', COUNT(*) FROM position_manager__transfer;
```

```
 t                 | n
-------------------+-------
 swap              | 52393
 initialize        | 260
 modify_liquidity  | 7001
 position_transfer | 1879
```

That is 52,393 swaps, 260 new pools and 7,001 liquidity changes in thirty-seven minutes. Uniswap V4 on
Robinhood Chain is not quiet. The busiest single pool took 4,854 of those swaps:

```sql
SELECT id AS pool_id, COUNT(*) AS swaps
FROM pool_manager__swap GROUP BY id ORDER BY swaps DESC LIMIT 3;
```

```
 pool_id                                                            | swaps
--------------------------------------------------------------------+-------
 0x8cde4c0932574d589aa2b8009bec7a0d690f68310ff543d7d442f29531e839bc | 4854
 0x7e9d88387872d39697afd9fe8b66e51f95d3e8f74efbc95f59a1e6a817c0e67d | 2801
 0xfe21f429c7bff20d4ca9600b3a6f64232a8ba9e76b4d5df994e569481d060e34 | 2665
```

The nest kept following the chain after that, and it would have gone on doing so for as long as we left it
running. It served every one of those tables over SQL and HTTP the whole time.

## What you get, and what you do not

**You get the event record, exactly.** Every swap, every pool initialisation, every liquidity change,
every position NFT transfer, with the pool id, the sender, the amounts and the ticks as the contracts
emitted them, in tables you own. For bots, analytics you intend to compute yourself, reconciliation,
or simply seeing what is happening on a new chain, that is the data you wanted.

**You do not get the subgraph's derived entities.** A Uniswap subgraph's mapping code turns those events
into `Pool.totalValueLockedUSD`, token prices, daily volume and so on, by calling token contracts and
carrying state from one event to the next. Nuthatch does not run that code. What the scaffold gives you is
the events the subgraph would have fed its handlers, so anything the subgraph *computed* is yours to
compute, usually as a SQL view over those tables. We have written at length about
[why that boundary exists](/blog/we-tried-to-drop-in-replace-a-subgraph/), and it applies here too.

## What to know before you try it

Three things, all measured rather than guessed.

**The free endpoint is rate-limited per second.** Robinhood's public RPC, `rpc.mainnet.chain.robinhood.com`,
is the only keyless endpoint that can back a nest, and it answers a burst of requests with HTTP 429.
Everything above ran on it, but we ran it with `--no-timestamps`, because fetching block timestamps is
what the throttle bites on. For a long backfill, or if you want timestamps, bring a keyed endpoint with
`--rpc`. The endpoint goes on the command line, never in the nest's config.

**Start blocks come from the manifest, or they have to come from somewhere.** A subgraph manifest carries
its `startBlock`, and nuthatch keeps it. If you `init` from a bare contract address instead, nuthatch tries
to find the deployment block, and the public endpoint refuses the historical reads that needs, so it starts
from a recent window. Give it an archive-capable endpoint with `--rpc`, or set the start block yourself.

**Sealed data trails the tip by about twenty minutes.** Nuthatch only writes immutable Parquet past the
point where a block cannot be reorganised, and on Robinhood Chain that is the network's `finalized` tag,
about 12,000 blocks behind the tip. The newest blocks are still queryable in the meantime; they simply are
not sealed yet. And at ten blocks a second, about ten blocks share each one-second timestamp, so a
timestamp orders events only to the second.

## If this is you

If you have a subgraph for Robinhood Chain and Studio has refused it, you already have what you need.
`graph deploy` uploads the build to IPFS and prints its hash before the final step fails, and nuthatch
takes the manifest by that CID or by URL:

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch init --from-subgraph <your manifest CID or URL> --chain robinhood --no-timestamps
nuthatch dev
```

We tested the URL form above, not a CID from a Studio upload. A CID is fetched through The Graph's IPFS
gateway by default, then ipfs.io, and `--ipfs` adds others. If yours does not resolve, pass the
`subgraph.yaml` by URL instead.

When The Graph adds subgraph support for Robinhood Chain, your subgraph will deploy unchanged, and you can
choose between the two. Until then, the chain's data does not have to wait.
