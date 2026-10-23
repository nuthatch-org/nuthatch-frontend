---
title: "1. The data problem"
description: "Why a Nuthatch nest exists, and the exact boundary of the data it can promise."
order: 2
---

An Ethereum node can tell you what happened in a block. It is rather less interested in helping you
answer a product question such as “which addresses delegated to this indexer last week?” That answer
requires turning a stream of logs into a durable model, keeping it current as new blocks arrive,
and making it cheap enough to ask repeatedly. This is the ordinary work of an indexer.

The usual answer is a hosted subgraph. That is often an entirely sensible answer. A schema and its
mappings turn chain activity into a GraphQL endpoint, somebody else runs the infrastructure, and
the application obtains a pleasant query surface. The awkward moment is when that endpoint is
unreachable, unserved, behind the chain, or contains a capability that cannot be reproduced from
the chain alone.

Nuthatch starts from a smaller promise. A nest describes a chosen set of contracts, pinned ABIs,
events and SQL views. It reads logs from the chain, decodes those logs deterministically, and serves
the resulting event data through SQL and HTTP. There is no allocation, indexing market or hosted
control plane between the RPC endpoint and the query. A nest is something a team can keep beside
the application that depends on it.

That describes the event nest, which is the subject of this book. There is a second kind, and it is
worth knowing where it parts company before the chapters that follow assume otherwise.

## Accounts rather than contracts

A nest whose `nuthatch.toml` carries an `[address_history]` table and no contracts watches accounts
instead: their transactions, internal transfers, token transfers, withdrawals and the blocks they
produced. It needs no ABI. It serves that history at `/api` in Etherscan's shapes, so a client
written against an explorer can be pointed at it, and it answers a range it has not fetched with
`NUTHATCH_INCOMPLETE` and an action it does not serve with `NUTHATCH_UNSUPPORTED`, rather than with
an empty list a client would read as no history at all.

It runs on a light path of its own: one cursor reading the chain head and backfilling each watched
account up to the finalized block, with no SQL engine, no sealing and no derived entities. The
tables, views, segments and mirrors of the following chapters therefore do not apply to it. It is not
mounted beside event nests in a runtime, though one `nuthatch dev` can answer for several chains'
address-history nests behind a single `/api`. The accounts it watches are private and change at
runtime, so they are kept out of the nest's identity, and such a nest is never bundled.
[RFC-0063](https://github.com/nuthatch-org/nuthatch/blob/main/docs/rfcs/0063-address-history.md)
has the design and its coverage limits.

## The useful boundary

A transaction log is public chain history. Given the same block range, contract addresses and ABI,
two honest implementations should decode the same rows. This makes event indexing a good substrate
for a portable local index. It also makes it possible to verify the result independently rather
than taking an API's word for it.

Not all subgraph data has that property. A mapping may make `eth_call`s whose result depends on the
block, fetch IPFS content, call an external service, or maintain bespoke off-chain state. Those are
not mistakes. They are simply dependencies that lie outside the event stream. Pretending that a
log index automatically offers parity with every such mapping is the beginning of a fairly tedious
outage.

Two of those dependencies Nuthatch now handles, and it is worth being precise about how, because the
manner matters more than the fact. A `[[calls]]` declaration reads a contract at a **fixed block**,
and the result is addressed by the question that produced it: chain, block, contract, calldata. An
`[[ipfs]]` declaration resolves a document and **verifies the bytes against the address that names
them**. Neither is the ambient, unrecorded fetch that makes a mapping hard to re-execute. The
property this chapter cares about - that two honest implementations agree, and that you may check
rather than trust - is preserved in both cases, because a pinned question has one answer and a
content address describes exactly one document.

What remains outside is what always was: an external service, a value that depends on when you asked,
bespoke off-chain state. Those are still dependencies rather than data, and naming them is still the
first honest step in a port.

The first question in a port is therefore not “can Nuthatch replace this subgraph?” It is “which
reads are event-derived, and what does each remaining read depend on?” Many useful reads turn out
to be straightforward: transfers, swaps, delegation changes, registration records and cumulative
balances. Some current-looking values can be derived from ordered events, such as ERC-20 supply
from mints and burns. Others genuinely require a contract read or external input. Name the boundary
before promising a fallback.

## A modest but strong promise

This bounded scope gives Nuthatch several useful properties:

- The input is inspectable. A nest vendors its ABI and says which events it accepts.
- The output is repeatable. Decoding is a pure transformation of log plus authored decode rules.
- The operator owns availability. An application may query its own machine or an API it controls.
- Historical data can be sealed and retained without keeping a full node or a bespoke database
  cluster alive forever.
- Sealed history travels. Since 4.9.0 an operator can publish a nest's sealed segments as a
  mirror, and another operator can seed a new nest from it instead of backfilling over RPC, with
  every file checked against the content address the catalogue names. What the hashes do not
  prove is that the catalogue is true to the chain; that remains the reader's question to ask of
  whoever published it.
- The same history can be read without the binary at all. The [playground](/play/) runs Burrmill,
  the query engine, as WebAssembly in a browser tab over a published nest's segments, checking each
  against its hash, and the [nest builder](/play/build/) scaffolds a nest from a contract address
  with `init`'s own code, shows its NID, and indexes it in the tab or hands it over for `nuthatch
  dev`. The mirror's publisher is still the party being trusted.

The machine does not know the business meaning of an event. It knows how to preserve and present it
without quietly changing its mind. The semantic layer belongs in views and application code, where
it can be reviewed as such.

## A running example

Imagine a protocol dashboard that normally asks a GraphQL subgraph for recent delegations. Its
critical screen needs the delegator, indexer, timestamp and amount. Those values originate in a
specific event. A nest can watch the protocol contracts, decode that event into a table and expose
a view with precisely those columns. The dashboard retains its normal endpoint, but gains a small
and independently operated fallback for the read it cannot afford to lose.

This is not an ideological replacement programme. It is a good operational shape: use the rich
surface you have, and keep the irreplaceable event data somewhere you control. The practical
[subgraph fallback guide](/docs/build/subgraph-fallback/) walks through that exercise. Where the
dashboard's queries ask only for event-shaped fields, the separate `nuthatch-graph` download
(attached to every release since 4.11.0) can answer the subgraph's own GraphQL for them and refuse
anything else by name; the default binary serves no GraphQL at all.

The next question is how that small description remains trustworthy after it has left your laptop.
That is the work of the authored nest.
