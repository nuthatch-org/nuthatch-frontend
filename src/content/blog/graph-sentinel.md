---
title: "graph-sentinel: a monitor for the failures that pass every other monitor"
date: "2026-11-14"
description: "graph-sentinel is a read-only daemon an indexer runs beside graph-node and tap-agent. It catches dead-but-healthy deployments, Rewards Eligibility Oracle shortfalls, broken TAP payment paths, POI deadlines and disputes, attaches a typed fix to every finding, and answers an operator's agent over MCP. It is open source as of today. This is what it checks, how fast it noticed each failure in a simulated stack, how a real graph-node v0.45.0 proved it wrong within two minutes, and what it caught there anyway."
author: "cargopete"
tags: ["graph-sentinel", "indexers", "the-graph", "tap", "reo", "mcp", "release"]
draft: false
---

Every failure that cost an indexer money in 2026 had one thing in common: **every monitor the
indexer ran was green while it happened.** Grafana was green, the index-node said `healthy`,
allocations closed on schedule. graph-sentinel is the thing I wanted on my own rig for those
afternoons, and as of today it is public at
[nuthatch-org/graph-sentinel](https://github.com/nuthatch-org/graph-sentinel), MIT or Apache-2.0.

## The stack reports its own state, and nobody checks it against anything

The incidents in the [design RFC](https://github.com/nuthatch-org/graph-sentinel/blob/main/docs/RFC-0001-indexer-sentinel.md)
are all public, and they rhyme. A Postgres connection blip kills a deployment's writer, the
writer is never replaced, and the status API carries on saying `healthy`
([graph-node #6730](https://github.com/graphprotocol/graph-node/pull/6730), still open). One
indexer closed **twelve consecutive allocations** on a single frozen deployment, across epochs 700
to 1007, before anybody looked.

The mainnet TAP aggregator once served a Cloudflare 526 page to gRPC clients. tap-agent logged
`invalid compression flag: 101`, which is not a sentence that makes anyone reach for the phone,
unaggregated fees crossed the loss limit, and indexers' own tap-agents denylisted the gateway.
The Foundation rotated the gateway sender on 24 September, and indexers who did not add it to
their config kept serving queries for days without being paid. The Rewards Eligibility Oracle
stepped its daily minimum from 1 to 5 to 10 qualifying subgraphs and applied each step
retroactively to the 28-day window; at launch, 47 of 97 indexers had not qualified.

None of this is exotic. In each case the component reported its own state faithfully, and the
state was wrong relative to something else: the chain head, the oracle's rule, the payment rail.
**graph-sentinel's whole job is to make that comparison.**

## It reads, and that is all it does

It is a single Rust binary that sits beside graph-node, indexer-agent, indexer-service and
tap-agent and reads interfaces they already expose: the index-node status API, tap-agent's
Postgres tables (with a read-only role), the network subgraph, your own RPC, and the TAP
aggregator endpoints. It holds no keys and signs nothing. The single write path, a
`graphman restart` on a deployment frozen for two ticks running, is off unless you turn it on.

Modules switch on from their sources, so the smallest useful config is one line pointing at the
index-node, and a fisherman's rig with no indexer runs liveness alone. There are five today:

- **Liveness** separates frozen from idle by probing `eth_getLogs` over each deployment's manifest
  addresses and topics, which is graph-node's own rule for whether a block has work in it. A
  deployment that is behind with matching events waiting is frozen; one whose contracts are quiet
  is not. It judges progress by graph-node's in-memory head, from the metrics port, for reasons
  the lab section below makes plain.
- **The REO meter** counts distinct deployments served per UTC day from TAP receipts, projects the
  oracle's next runs, and ranks the cheapest deployments to add. It keeps its own ledger, because
  tap-agent deletes receipts once a RAV covers them.
- **Payments** probes each aggregator as a gRPC server (status, `content-type: application/grpc`
  and a `grpc-status` header), which is how a Cloudflare error page gets caught, and watches
  senders, the denylist, fees against `max_amount_willing_to_lose_grt`, RAV age and escrow.
- **The network view** lists every open allocation with its POI deadline, and disputes against you.
- **The RPC spend guard** meters graph-node's provider calls against a daily budget.

Findings arrive on Telegram, Discord, Slack or a generic webhook when they appear, escalate or
clear, and never on a timer. A dashboard on loopback shows the rest.

## How fast it noticed, in a stack built to be broken

graph-sentinel has not yet run across a large production fleet, so the numbers I can honestly
publish come from `demo/`: a simulated graph-node, RPC, network subgraph and aggregator, and a
tap-agent writing into indexer-rs's real migrations in Postgres. `./e2e.sh` breaks one thing at a
time and times how long the finding takes to appear and then to clear. The demo ticks every 15
seconds, so these figures are about the logic, not about what you will see with the defaults.
Measured on 14 November:

| Incident | Finding | Raised | Cleared |
| --- | --- | --- | --- |
| a deployment stops while graph-node calls it healthy | `frozen` | 22 s | 30 s |
| a deployment fails with a fatal error | `failed` | 15 s | 31 s |
| the chain head stops | `chain_stalled` | 42 s | 31 s |
| receipts from a sender the config does not know | `unknown_sender` | 16 s | 33 s |
| tap-agent stops requesting RAVs | `rav_stalled` | 58 s | 31 s |
| a dispute is filed against the indexer | `dispute_against` | 30 s | 61 s |
| an allocation nears its POI deadline | `poi_due` | 28 s | 61 s |
| the oracle marks the indexer ineligible | `reo_ineligible` | 61 s | 118 s |
| a sender's escrow runs low | `escrow_low` | 16 s | 30 s |
| the aggregator serves a Cloudflare page | `aggregator_down` | 31 s | 30 s |

The first run had one failure, and the test was at fault. It stopped the unknown sender's receipts
and waited for `unknown_sender` to clear. It never did, because receipts already taken from a
sender with no aggregator entry stay unpaid, and graph-sentinel was quite right to keep saying so.
The recovery is configuring the sender, and the test now does that.

## Then it met a real graph-node, and was wrong within two minutes

A simulator only ever behaves the way its author expects, so the same afternoon I stood up a lab
on my own server: **graphprotocol/graph-node v0.45.0**, the version the RFC says still carries the
frozen-but-healthy bug, with eight real deployments taken from the network subgraph by signal,
on Arbitrum One, Base and mainnet through GraphOps RPC. Then I killed every one of graph-node's
Postgres connections at once, which is the blip that sets the bug off.

Inside two minutes graph-sentinel called two deployments frozen, then two more, and ran
`graphman restart` on the first two. Three of those four were perfectly well. One of them had
processed 216 blocks while graph-sentinel watched its head stand still at 33,799,448.

The cause is graph-node's write batching. A deployment that is syncing keeps its work in memory
and commits its block pointer **once per write batch, every 300 seconds by default**
(`GRAPH_STORE_WRITE_BATCH_DURATION`), and the index-node's status API reports the committed
pointer. The RFC's assumption that graph-node "walks the head through empty blocks" holds once a
deployment is synced, and not before. Two deployments scanning empty 2,000-block ranges hundreds
of thousands of blocks ahead were reported as stuck at their start block.

graph-node does publish the truth: `deployment_head` on its metrics port is the in-memory head.
Liveness now judges progress by the larger of the two, and without the metrics endpoint it will
not say anything worse than "idle" until a head has been still for longer than one write batch.
The lab's restart switch went back off and stays off until the fix has a longer record.

The Postgres blip itself did nothing to v0.45.0. Nor did my next attempt to manufacture the bug,
an exclusive lock held on one deployment's POI table for ten minutes: it went on processing 75 to
80 blocks a minute throughout, batching around the lock, and graph-sentinel rightly said nothing.
**I did not reproduce graph-node #6730.** What the lab did produce, unprompted, was better.

One of the eight deployments needs `trace_` calls, which the lab's provider was not configured
for. graph-node logged `Subgraph instance failed to run: A matching Ethereum network with
NodeCapabilities { archive: false, traces: true } was not found` at start-up, and from then on the
index-node reported it `healthy`, with no fatal error, at the block before its start block. That
is exactly the failure graph-sentinel exists for: dead, and green on every dashboard. It was
raised within a minute on both builds, and the remedy now says to look for that log line, because
a restart does nothing for it. The first build's restart proved as much.

Half an hour later a second deployment, one carrying 24,770 GRT of signal, failed outright at
mainnet block 20,586,647 with graph-node's own `impossible combination of entity operations`.
That one graph-node does report honestly, and graph-sentinel raised `failed` within a tick with
the error in the evidence. Whether it is a v0.45.0 bug or the subgraph's I have not yet looked.

## The fix travels with the finding

A notification that says what is wrong and then leaves you to work out the remedy at three in
the morning is only half a notification. **Every finding now carries a remedy**: typed steps, a
risk level, and how to tell it worked. A frozen deployment comes with the `graphman restart`
command filled in from your own config, and a note that it belongs on the graph-node host. A
denylisted sender comes with the two `DELETE` statements for tap-agent's tables, in the bare
lower-case hex tap-agent actually stores, and a precondition to check the aggregator first, since
with fees still over the limit tap-agent simply puts the sender back. An allocation near its POI deadline
comes with one `graph indexer actions queue reallocate` per allocation.

graph-sentinel never runs any of it. It proposes; the operator decides. The steps are typed rather
than prose so that the dashboard, a webhook consumer and an agent all read the same thing.

## Your agent can ask it what is wrong

Plenty of indexers now run Claude Code or something like it on the box itself, and when rewards
stop, the agent does what we all used to do: greps graph-node logs and guesses. So graph-sentinel
is also an MCP server, at `POST /mcp` on the dashboard's listener or over stdio with
`graph-sentinel mcp`:

```sh
claude mcp add --transport http graph-sentinel http://127.0.0.1:9477/mcp
```

The eight tools are all read-only: `overview`, `findings`, `deployments`, `reo`, `network`,
`payments`, `rpc_spend` and `sources`. The server's own instructions tell the agent that the
remedies are proposals and that anything above low risk wants the operator's approval. It is a
thin layer over the same snapshot the dashboard draws, which is the point: the agent gets the
evidence graph-sentinel already collected rather than a fresh opportunity to misread a log.

It refuses requests from a browser page on another origin, and, like the dashboard, has no login
of its own. Keep it on loopback.

## What it does not do yet

- **It does not check POIs against a reference.** The POI self-consistency gate is Module 2 of the
  RFC, and it is the one that would have caught the indexer who reused a POI 40 times across an
  active range on Polygon. It is designed and not built. Deadlines and disputes are watched;
  whether the POI itself is right is not.
- **The REO count is an upper bound.** TAP receipts do not record latency or block freshness, which
  the oracle also requires. When the oracle declines a run the receipts said should pass,
  graph-sentinel says so with `reo_oracle_disagrees`, rather than pretending.
- **Its history starts when it does,** because tap-agent deletes the receipts it would need.
- **The payment and REO modules have not met a production indexer.** Liveness and the network
  view have now run against a real graph-node; the TAP checks have run against indexer-rs's real
  migrations and the demo, which is not the same as six months on forty indexers. I would rather
  say so here than in a post-mortem.
- **The RPC spend guard prices only the providers it knows.** GraphOps is not one of them, so the
  lab's spend read $0.00 all afternoon, which was not true.

## Try it

```sh
git clone https://github.com/nuthatch-org/graph-sentinel
cd graph-sentinel/demo && docker compose up -d --build
open http://127.0.0.1:9477/
./incident.sh freeze
```

The install guide for a real Docker indexer stack, with the read-only Postgres role and the
Telegram bot, is [docs/install.md](https://github.com/nuthatch-org/graph-sentinel/blob/main/docs/install.md).
If you run it and it tells you something wrong, or fails to tell you something right, an issue
with the finding's evidence is the most useful thing you can send.
