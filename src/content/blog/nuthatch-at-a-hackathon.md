---
title: "The hackathon indexer is the one without a quota"
date: "2026-09-11"
description: "A builder at ETHOnline was rate-limited off Subgraph Studio in under an hour. The arithmetic behind that, what a local nest costs to run instead, and the places where the subgraph still wins."
author: "cargopete"
tags: ["nuthatch", "hackathon", "the-graph", "subgraphs", "testnets", "sepolia", "arc"]
---

> **The hosting offer below was retired 2026-09-29; Nightswatch no longer hosts nests.** The rest of
> this post stands as written.

*This morning a builder at ETHOnline 2026 asked The Graph's Discord for "a massively increased rate
limit for the next week". His app polled his Sepolia and Arc Testnet subgraphs seven times every five
seconds and ran out of quota in under an hour. We spent the day working out what would actually help
him, and most of it generalises to anyone building on a testnet against a deadline.*

---

## The arithmetic that ends a hackathon

A subgraph deployed to Subgraph Studio but not published to the network is served from a development
query URL, and the documentation states the limit plainly: **3,000 queries per day**. Seven queries
every five seconds is about 120,000 a day. That is a factor of forty, and no amount of asking nicely
in a support channel closes a factor of forty on an endpoint that was built for smoke tests.

The paid route exists for chains the network supports. Ethereum Sepolia is one of them, so a Sepolia
subgraph can be published and billed at $2 per 100,000 queries after the free 100,000. Arc Testnet
is not: the networks registry lists it with `issuanceRewards: false` and Subgraph Studio as its only
service, checked 11 September 2026. There is no tier to buy. For that chain the choice is 3,000
queries a day or something that is not the hosted endpoint.

## What a nest costs to run

Nuthatch is one Rust binary with an embedded database, and it runs on the laptop you are already
typing on.

```sh
curl -fsSL https://nuthatch-indexer.com/install.sh | sh
nuthatch init --from https://github.com/nuthatch-org/hackathon-nest
nuthatch dev --dir hackathon-nest
```

The starter indexes Circle's testnet USDC on Sepolia from a pinned recent block. Measured today from
that repository: **1,086 blocks, 4,016 transfers, ready in under five seconds**, after which it
follows the tip and serves an HTTP API on port 8288. There is no key, no account, and no counter
ticking down while you debug. Query it a thousand times a minute if your test loop wants to; the
only thing that notices is your CPU, and it does not notice much.

```sh
nuthatch sql --dir hackathon-nest "SELECT * FROM recent_transfers LIMIT 5"
```

The tables are one per event, named `alias__event`, and the API takes read-only SQL over them. Two
views ship in the starter so there is something to look at before you write your own.

## Your subgraph is already the config

A deployed subgraph has a deployment ID, and the manifest behind it pins every ABI and start block.
Nuthatch reads that directly:

```sh
nuthatch init --from-subgraph QmYourDeploymentId \
  --chain sepolia --rpc https://ethereum-sepolia-rpc.publicnode.com --dir my-nest
```

Every `dataSource` becomes a contract, every template becomes a template, the ABIs are vendored from
IPFS, the start blocks carry across, and the handler list becomes the event allowlist. The import
prints a report of what it mapped and what it could not, and the second half of that report is the
part worth reading.

What the manifest cannot tell us is what your mapping did. That has a config equivalent in each
case, written by hand. Entities derived from several events become SQL views. A contract call in a
handler, the `balanceOf(event.params.to)` shape, becomes a `[[calls]]` block with `on = "<table>"`,
which fires one `eth_call` per row at that row's block. A call handler is `[extract] top_level_calls
= true`. A file data source is an `[[ipfs]]` block. A block handler has no equivalent, and the report
says so rather than pretending.

## Testnets are where the public RPCs go to die

The honest part of running your own indexer on a testnet is that it needs an RPC, and the keyless
ones are in poor health. We probed every public Sepolia endpoint we could name with `nuthatch doctor`
on 11 September. One passed.

| Endpoint | Result |
| --- | --- |
| `ethereum-sepolia-rpc.publicnode.com` | getLogs up to 2,560 blocks, batching fine, state pruned about 1M blocks behind tip |
| `sepolia.drpc.org` | "chain is not available on free plan" |
| `1rpc.io/sepolia` | getLogs capped at 10 blocks, then a usage limit |
| `rpc.sepolia.org` | HTTP 404 |
| `sepolia.gateway.tenderly.co` | transport error |
| `eth-sepolia.public.blastapi.io` | transport error |

Arc Testnet is not in the built-in chain registry, so it is named on the command line with
`--chain arc-testnet --rpc https://rpc.testnet.arc.network`. Nuthatch reads the chain id from the
endpoint (5042002) and treats it as a conservative L1. The official endpoint answered `eth_getLogs`
in 160-block ranges and returned HTTP 429 when probed quickly, so a backfill there starts with
`--window 80` and the default concurrency of one.

A free Alchemy or Infura key fixes all of this, and it never has to touch the config: `nuthatch dev
--rpc <url>` overrides the endpoints at runtime, so the nest you share is the same nest with the key
left out.

## The polling was the fault all along

Sepolia produces a block every twelve seconds. Seven queries in five seconds is seventeen requests per
block for an answer that changed once. That arithmetic is the same whether the thing being asked is
Studio, the network, or a nest on your own machine, and it is the difference between a quota that
lasts an hour and one that lasts the week.

The fix is to query on new blocks rather than on a timer. A `newHeads` subscription on the RPC
websocket costs nothing against any indexing quota, and one query per block is all the app ever
needed. Against a nest, `GET /ready` is cheap and carries `last_block`; poll that and run the real
queries when it moves. And if the app fans out to six follow-up queries when it spots an opportunity,
those are six root fields in one GraphQL document, not six requests.

## Judges need a URL, not a laptop

`nuthatch dev` is also the serve command, so a demo box is one process and a reverse proxy:

```sh
nuthatch dev --dir my-nest --listen 0.0.0.0:8288 --no-admin
```

Put Caddy in front for TLS, and either pass `--no-admin` or set `NUTHATCH_ADMIN_TOKEN`, because off
localhost the admin UI refuses to serve without one. The `/sql` endpoint carries its own guards, a
timeout and a row cap and a concurrency cap, which protect the box from a runaway query and are not
a rate limit on you.

One limit worth knowing before the demo: **the API sets no CORS headers**. A browser page on another
origin cannot call it directly. Call it from your server side and hand the rows to the page, which is
where an API key would have lived in any case.

> **Updated, 2026-10-01.** That limit is gone. Since 3.8.0, `nuthatch dev` and `nuthatch serve` take
> `--cors <ORIGIN>` (repeatable, or `*`), and a page on that origin can call the nest directly. Checked
> against 3.13.3: an allowed origin gets `access-control-allow-origin` back, any other origin does not.
> Off by default, so a nest you have not opted in still sends no CORS headers. A tunnel from the laptop works for a week-long demo,
with the obvious caveat that the laptop has to stay open.

## Where the subgraph still wins

If you are in a Graph prize track, the judges want to see the subgraph doing the work. That is the
point of the track. The sensible split is a nest for the build-and-test loop, where you query hundreds
of times an hour and a quota is a tax on iteration, and the subgraph in the demo. Or run both, and
fall back to the nest if the quota dies mid-judging.

The Graph has, to its credit, already made room for this. ETHGlobal Lisbon's $7,000 Best AI Tooling
track in July named Nuthatch as an accepted data backend alongside Subgraph Studio. If your event has
a track like that, check before you decide which half of the split is the demo.

And a nest on one box is one box. The network has indexers in several countries with someone paid to
keep them up; your VPS has you. For a week that is fine. For a product it is a decision.

## We subsidise hackathon projects, always

If you are building on a testnet against a deadline and the quota is in the way, send us a message
and we will build the nest, test it, and host it for the duration at no cost. The builder above is
the first case: four unverified contracts on Arc Testnet, thirty events in total, two nests on our
box within forty minutes of his addresses arriving. The whole of it, including the nuthatch bug it
found, is in [We will host your hackathon nest](/blog/we-host-your-hackathon-nest).

## Try it

The starter is at
[github.com/nuthatch-org/hackathon-nest](https://github.com/nuthatch-org/hackathon-nest), with the
quickstart above and the endpoint table dated so you know when to re-measure it. If it does not work
on your chain, the [Nuthatch Discord](https://discord.gg/p9Xc45txWa) is where the people who
run these sit, and one of them will probably have hit your problem before.
