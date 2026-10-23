---
title: "Build a subgraph fallback"
description: "Keep the event-derived part of a GraphQL data path available when a subgraph is unavailable."
order: 6
checked: 5.10.0 (2026-10-23)
---

Nuthatch is not automatically a drop-in GraphQL replacement. It indexes deterministic on-chain event
data and exposes it as read-only SQL over HTTP. That is enough to make a useful fallback for many
subgraph reads, provided the boundary is made explicit before an outage.

The default binary and image have no GraphQL route: `POST /graphql` answers `404`. Since 4.11.0 every
release also attaches a `nuthatch-graph-<target>.tar.gz` download, built with `--features graph`, which
serves a nest's Graph-dialect GraphQL at `/graphql` and `/subgraphs/id/<deployment>`. It is a partial
read surface: a field derived from events answers exactly, and anything else is refused by name
(``"`transfers` is not served by this nest: it has no `transfer` view"``), never answered with a
substitute. GraphQL fails a whole query for one refused field, so an analytics client that asks for
prices or running totals will usually not work unmodified; a bot or an event reader usually will.

The useful question is not “can we replace this entire subgraph?” It is: **which reads cannot afford to
disappear, and are they derivable from chain logs?**

## Hosted nests and stopgaps

If you would rather not run it yourself, Nuthatch hosts nests on request: the stock binary, run as
any operator would, with no billing and no account. [Nest-backed subgraphs](/subgraphs/) is the
public offer; reach out on the Nuthatch Discord with the subgraph, or its contracts and chain.

Stopgaps were the first case. From 2026-10-08 Studio traffic for BNB Smart Chain and Polygon moves
onto The Graph network, and a deployment no network indexer picks up stops answering. For those,
Nuthatch serves **stopgap nests**: the stock `nuthatch-graph` binary, answering the subgraph's event-derived fields until an indexer serves the
deployment and its developer points back at the network. The first is BetSwirl on BNB Chain; [its handback package](https://github.com/nuthatch-org/nuthatch/blob/main/docs/stopgap/betswirl-bnb.md)
says what it answers, how to run it yourself and how to go back.
[The dispatch on learn-thegraph.com](https://learn-thegraph.com/dispatches/stopgap-nests-for-stranded-subgraphs/)
explains how many deployments were stranded, what a stopgap nest is and is not, and how its answers
were checked.

## 1. Start with the reads that matter

Write down the GraphQL queries or dashboard panels that need a fallback. For each one, identify the
entities and fields it uses, then identify how its mappings create them.

| Mapping input | Fallback status | What to do |
|---|---|---|
| Contract events | Good fit | Index the contracts and write a SQL view for the query shape. |
| Deterministic transforms of events | Good fit | Express them as a view or a first-party recipe. |
| Contract state via `eth_call` | Supported, pinned | Derive it with a [recipe](/docs/build/recipes/) where possible; otherwise declare a pinned [`[[calls]]`](/docs/build/contract-calls/) read and run with `--state-rpc` against an archive node. |
| IPFS documents | Supported, verified | Declare an [`[[ipfs]]`](/docs/build/contract-calls/#ipfs---documents-verified) side table; a body that does not hash to its CID yields no row. |
| Another off-chain fetch | Not current parity | State the omission explicitly; do not call the result a full port. |
| Bespoke off-chain state or external APIs | Not a Nuthatch fallback | Keep the existing service or build a separate bounded adapter. |

This classification is the work. It is far cheaper to say “token metadata is outside this fallback” in
advance than to discover it when the GraphQL endpoint is unavailable.

## 2. Build the event surface

Create a nest from the deployment, then narrow it to the events the affected queries actually need:

```sh
nuthatch init 0xYourContract --chain arbitrum-one --alias protocol
```

`nuthatch init --from-subgraph <CID>` scaffolds instead from the deployment's manifest, with its
contracts, templates, ABIs and start blocks. `nuthatch port-emit --dir <subgraph source> --out <nest>`
then copies in `graph/schema.graphql` and writes `[[calls]]`, a view per exact field, checks, and a
README naming every field it did not emit. It reads
the AssemblyScript mappings, so point it at the subgraph's source repository: a deployment CID carries
only compiled WASM, and since 4.11.0 `port-emit` says nothing was classified and exits non-zero rather
than reporting full coverage.

In `nuthatch.toml`, use each contract's `events` list to avoid indexing unrelated ABI events. Vendor
the ABI with the nest. The ABI is part of the authored package, so anyone running the fallback decodes
the same events in the same way.

```toml
[[contracts]]
alias = "protocol"
address = "0xYourContract"
abi = "abis/protocol.json"
events = ["PositionOpened", "PositionClosed", "FeesCollected"]
```

Run `nuthatch schema` after editing the configuration, then inspect `/tables` or `schema.json`. This is
the exact SQL surface available to the fallback, not a hopeful reconstruction of the old schema.

## 3. Recreate only the query shape you need

Put derived reads in `views/` as ordinary `CREATE VIEW` statements. A view can join event tables,
aggregate them, and give columns names that make the consuming code simple.

```sql
CREATE VIEW protocol_recent_positions AS
SELECT owner, position_id, MAX(block_number) AS last_event_block
FROM protocol__position_opened
GROUP BY owner, position_id;
```

Views are query-time logic over the hot tip and sealed history. They do not change the deterministic
decode path, and editing one does not require a raw-chain backfill. Add meaning to `semantic.toml` so
both people and MCP clients know the view's grain and its limits.

## 4. Prove the boundary before you need it

Backfill against an RPC endpoint that can serve the deployment block. Use `nuthatch doctor` first,
then compare a fixed historical range with the subgraph while it is healthy.

```sh
nuthatch doctor --rpc https://your-rpc.example --address 0xYourContract
nuthatch dev --seal-direct --rpc https://your-rpc.example
nuthatch sql 'SELECT count(*) FROM protocol__position_opened'
```

Commit checks for the view where possible. The goal is not merely that a query returns rows; it is that
the fallback's stated event-derived answer agrees at a known watermark.

## 5. Put the switch in the consumer

Keep the GraphQL subgraph as the normal path. When the relevant query fails or becomes unhealthy, send
only that read to the nest's SQL endpoint or to a small adapter which translates the narrow result shape
your application needs.

If the nest is already indexed, the switch is immediate. Keep the endpoint behind your own gateway:
TLS, authentication, and a named-query allowlist where callers should not have free-form SQL. A public
nest without an allowlist is an open query engine, which is a rather generous outage plan.

The fallback should carry its boundary in its UI and API documentation. “Event-derived position
activity, not IPFS metadata” is a good contract. “Parity, probably” is not.

## A useful handoff

If somebody else will operate the fallback, give them:

- the deployment address and chain;
- the pinned ABI and exact event list;
- the GraphQL queries or panels being protected;
- the SQL views and a fixed-watermark comparison;
- the explicit list of fields that remain outside the fallback;
- the gateway route and health signal the consumer uses to switch.

That is enough for another operator to run the same data path without having to reverse-engineer intent
from a stale subgraph manifest during an incident.

## Next

- [ABIs, events & tables](/docs/build/tables/) - what the event surface looks like in SQL
- [Authored SQL views](/docs/build/views/) - write the narrow derived reads
- [Run it in production](/docs/operate/production/) - backfill, expose, monitor, and back it up
- [Nest identity & reuse](/docs/concepts/nest-identity/) - package versions and inexpensive updates
