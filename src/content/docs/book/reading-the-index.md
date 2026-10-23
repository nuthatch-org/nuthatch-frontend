---
title: "5. Reading the index"
description: "Raw tables, query-time views, maintained entities, HTTP and SQL."
order: 6
---

An index is useful only when somebody can ask it a question. Nuthatch exposes decoded event data as
tables and makes that data available through read-only HTTP and SQL surfaces. The system is
intentionally more ordinary than a bespoke query language. SQL is well understood, inspectable and
capable of expressing both a simple point lookup and a careful event-derived calculation.

## Start from the raw event

Every selected event has a table, including an event which the contract has not emitted yet. In
that case the table is present and empty, rather than appearing only on the day the first log
arrives. The table contains decoded event fields and chain coordinates: block number, block hash,
block timestamp (on unless the nest was scaffolded with `--no-timestamps`), transaction hash, log
index, emitting address and a sequence number. There is no transaction index; the log index is
block-wide, so it alone orders a block. These columns let a consumer order simultaneous events,
trace a result back to a transaction and decide how to display the distance from finality.

Raw tables are the audit trail. They may not be the API a product wants to hand to a browser, and
that is quite all right. They are the stable base upon which a product-specific interface can be
built. When a view looks suspicious, the raw log-derived rows provide the way to check it.

## Views give event data a useful shape

An authored SQL view is part of the nest package. It can rename columns, select a narrow consumer
surface, join related event tables and derive incremental-looking answers from the event history.
For example, an ERC-20 total supply can be calculated from mints and burns, and a latest Uniswap V2
reserve can be selected from the latest `Sync` event per pair. These are not opaque mapping code.
They are reviewable SQL over a known, pinned input.

This is a strong capability, but it has limits. A view is only as sound as the event model beneath
it. A historical event stream cannot reproduce a state variable that was changed without an event,
or content that a subgraph fetched from IPFS. An `eth_call` at a particular block may be necessary
for some questions.

Where such a read is necessary, it is **declared** rather than performed quietly: a `[[calls]]` or
`[[ipfs]]` block in the nest's configuration, pinned to a block or checked against a content address,
and stored in a table of its own that a reader can see and interrogate like any other. The
distinction this section is drawing survives intact. Nuthatch makes the event-derived part
dependable, and it does not perform other forms of data acquisition behind the reader's back - it
performs them in front of the reader, or not at all.

## An answer that is already computed

For a question that is expensive, repeated, and naturally keyed, Nuthatch 3.0 adds a third surface:
an authored incremental entity. Its `SELECT` is deliberately restricted, declared with a key and a
row bound in `entities.toml`, then maintained as each block arrives. The relationship is not a cached
view. A reorganisation submits the removed facts as retractions, and the maintained answer retracts
with them.

This changes where the cost falls. A normal view is free until a reader asks, and is the correct
default. An entity reserves memory whether it is queried or not, and makes every incoming block pay a
small update cost. The payoff is that a reader need not fold all sealed history again. On Lodestar, the
same 82-row rewards result moved from 2.15 seconds at p50 as a view to 87.7 ms as an entity.

That comes with an operator's obligations. The declared maximum rows is a hard admission bound, a
fault quarantines rather than serving a frozen answer, and a restart seeds the entity from locally
stored facts before serving it. The maintained relation is read by key under `/derived` and by
name from `/sql`, beside the decoded tables. The [entities guide](/docs/build/entities/) spells out
those limits.

A view that is merely slow, rather than naturally keyed, has a gentler option since 4.14.0: list it
in `maintained.toml`, and the nest keeps a copy of its answer, computed after each change and served
only while the inputs it was computed from are still the current ones. The next chapter sets the
three side by side.

## Serving safely

The SQL endpoint is read-only and bounded. It has a concurrency semaphore, a request timeout, a
row cap and an upper limit on the unsealed rows a scan may include. A public deployment should use
named queries or an allowlist when it does not intend to offer general SQL. The runtime enforces
these local resource bounds, while a gateway in front supplies authentication, rate limits and
tenant policy.

The HTTP API offers conventional endpoints for discovery and tables as well as `/sql`. Admin routes
are a distinct set of routes under `/_admin`, and they may mutate runtime state, such as mounting or
unmounting a dataset. They are not a separate listener: they sit on the same port as the data API,
and the binary mounts them only when that port is loopback or an admin token has been set in the
environment, with `--no-admin` to leave them out altogether. It is important not to describe the
whole server as "read-only" merely because its data API is. The administrator can make changes, so
the port that carries the admin routes needs the corresponding protection.

MCP and semantic descriptions provide more guided access for agents and tools. They are not a
second data model. They describe and query the same underlying tables, views and entities.

## What happened here

Since 5.9.0 a nest can also say what happened in a block, a range or a transaction.
`nuthatch diff --block N` (or `--from A --to B`, or `--tx HASH`) tells it in fixed sentences, built
from the rows the nest already holds and no language model: control-plane events such as ownership,
pauses and upgrades in full, the largest movements per token, new holders, approvals, and every
other row either told by a `story` line its author wrote in `semantic.toml` or grouped. `--flow`
draws the token flow instead. `GET /diff` and the MCP `diff` tool return the same document, byte for
byte. A range above the sealed boundary is told and labelled provisional, and `--final-only` refuses
it.

The diff inherits the boundary of the nest beneath it. An event nest can tell only the events it
indexes: a native transfer, or a call that emitted nothing it selected, is not in its rows, and the
document says what it could not see. Net flow is the sum of the transfers seen, not a balance. On an
address-history nest the same command reads the watched accounts' transactions and transfers
instead.

## A good consumer contract

For a dashboard or service, define a small query contract: the rows, ordering, finality behaviour
and error policy it actually needs. Put the contract in an authored view or named query. Test it at
a fixed watermark. Then an application can switch from a degraded primary endpoint to the nest
without improvising SQL during the incident, which is a period when even ordinary punctuation can
become a tactical challenge.

The [SQL reference](/docs/reference/sql/), [HTTP API](/docs/reference/http-api/) and
[authored views guide](/docs/build/views/) provide the exact surfaces. The next chapter explains
when an answer is worth keeping rather than computing on each request, and the two ways of keeping
one.
