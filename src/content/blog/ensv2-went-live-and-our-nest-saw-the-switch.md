---
title: "ENSv2 went live on 27 October. Our nest saw the switch"
description: "ENS moved .eth to its v2 contracts on mainnet on 27 October 2026. A nuthatch nest following every ENS contract since 2017 recorded the cutover to the minute: the last v1 registration, the first v2 label, and 25,884 names migrated in the first week. This is what the chain shows, how the nest was built without the v2 mapping source, and where it still falls short of ENS's own indexing guide."
date: 2026-11-04
author: "cargopete"
tags: ["nuthatch", "ens", "ensv2", "ethereum", "subgraphs", "sql"]
---

*On 27 October ENS [announced](https://x.com/ensdomains/status/2115082389169004777) that ENSv2 was live on Ethereum mainnet. By coincidence we had spent the
same day building a nest for it, one that indexes the ENS registries, registrars, NameWrapper and
resolvers from 2017, plus the new v2 contracts. So the cutover is in our tables, timestamped to the
block. What follows is what it looks like, how the nest was put together, and the list of things it
does not yet do, which is not short.*

---

## The switch, as the chain recorded it

An announcement says when a launch was. The chain says when it happened, which is not always the same
time. Each row below is one SQL query against the nest, and every timestamp is a block timestamp, in
UTC, on 27 October 2026.

| Time (UTC) | Block | What the nest recorded |
|---|---|---|
| 05:33:47 | 26,281,976 | The last `.eth` name registered through the v1 `BaseRegistrar`. Nothing has been registered there since. |
| 06:12:47 | 26,282,171 | The first `LabelRegistered` on the v2 `ETHRegistry`: the label `on`, sent by an address that is not in ENS's published deployment list. |
| 08:09:23 | 26,282,753 | The first registration through the v2 `ETHRegistrar`: `farm3`. |
| 08:12:11 | 26,282,767 | The second and third, in one block: `malak67` and `v2testreg`. |
| 08:38:47 | 26,282,899 | The first name moved across by the `UnlockedMigrationController`. |
| 09:09:35 | 26,283,053 | The last `NameRenewed` on the v1 `BaseRegistrar`. |
| 15:16:23 | 26,284,884 | The first name moved by the `LockedMigrationController`. |

The query behind the first row is the kind of thing nuthatch is for:

```sql
SELECT block_number, to_timestamp(block_timestamp) AS t
FROM base_registrar__name_registered
ORDER BY block_number DESC
LIMIT 1;
```

It answers in about 2.1 seconds over all 4,070,279 `.eth` registrations since January 2020. Someone was
evidently testing in production at 08:12, and we see no reason to judge them for it.

The v1 registrar averaged 219 registrations a day over 16 to 26 October. The v2 registrar averaged 168
over the first full week, 28 October to 3 November. That is one week of data, launch week at that,
and we would not read a trend into it.

## Most of the first names in v2 were moved, not bought

At block 26,343,252 (4 November) the v2 `ETHRegistry` holds 27,658 `LabelRegistered` events. ENS's
[indexing guide](https://docs.ens.domains/ensv2/indexing/) says a migrated name skips the registrar,
and that the event's `sender` identifies the migration controller. Grouped by sender, they account for
every row:

| Sender | Contract, per ENS's [deployments page](https://docs.ens.domains/learn/deployments/) | Labels |
|---|---|---|
| `0xab82...eb64` | UnlockedMigrationController | 25,862 |
| `0xd6d8...cc81` | ETHRegistrar | 1,773 |
| `0x3cea...e51a` | LockedMigrationController | 22 |
| `0x85a7...5c20` | Not listed | 1 |

**So 25,884 of the first 27,658 v2 names, 93.6%, are v1 names moved across, and 1,773 are new
registrations.** The registrar's own `NameRegistered` count at the same block is also 1,773, which is
the check we wanted: two contracts, one number.

There are also 929,479 `LabelReserved` events on the `ETHRegistry`, 914,997 of them between 3 and 9
October, and none after the 27th. A reservation is a `register()` call with no owner and no roles, so
no token is minted. The timing suggests the namespace being prepared for launch, but ENS's guide is
explicit that reservation should not be assumed to be part of migration, so we are not claiming it is.

## How the nest was built without the v2 mapping source

The published ENSv2 subgraph gave us the contract list and the event signatures. It did not give us
the mapping logic: the v2 mapping code is published only as compiled WebAssembly, so there was nothing
to read. The v1 mappings are open source in
[`ensdomains/ens-subgraph`](https://github.com/ensdomains/ens-subgraph).

The nest is one `nuthatch.toml` and four SQL files. It watches 12 static contracts, from the 2017
registry at block 3,327,417 to the v2 `RootRegistry` at 26,183,742, and finds the rest with nine
factory rules. Resolvers are discovered as names point at them: `NewResolver` on the v1 registries,
`ResolverUpdated` on the v2 ones. Registries are discovered through `SubregistryUpdated`. Every event
becomes a table with its block, log index, transaction and decoded arguments: 125 event tables, and
34 views written in SQL on top of them.

Two things in the subgraph manifest did not carry over directly. Its resolver sources have no
address, because graph-node matches those events from any contract on the chain. Nuthatch does not do
wildcard ingestion, so the factory rules stand in for it. And the v2 registry template watches itself,
since a subregistry can have subregistries of its own. Nuthatch refuses a template that spawns itself,
so the recursion is unrolled to two levels.

Our automatic port of the subgraph answered 7 of its 183 entity fields exactly. The rest is hand-written
SQL, and for v2 there are no entity views at all, only the events.

## What we checked against the chain

On 27 October, at block 26,285,685, we drew 200 names at random from the current v1 registry. For each
one we rebuilt the owner, resolver and TTL from events alone, then asked the registry contract the same
question with `eth_call` at the same block:

```
block 26285685: 200 nodes; owner 200/200, resolver 200/200, ttl 200/200
```

We checked against the contract and not against another indexer, so any disagreement would have
been ours.

**We have not run the same check on v2.** The v2 counts above reconcile with each other, and the
contract addresses match ENS's deployments page, but no v2 table has yet been compared with an
`eth_call`. Until it has, treat the v2 side as events we decoded correctly, not as state we have proved.

## Where it falls short of ENS's own guide

ENS's indexing guide is clear and specific, and measured against it the nest has gaps, which we have
counted rather than estimated where we could.

- **We do not watch `ProxyDeployed`.** The guide says to discover registries and resolvers from the
  `VerifiableFactory`, because a proxy can emit events before any name links to it. Discovering by link
  reaches 14,702 of the 14,739 `PermissionedResolver` proxies deployed so far, and 985 of the 988 user
  and wrapper registries. The 37 resolvers and 3 registries left over are invisible to us, and so is
  anything a linked proxy emitted before it was linked. We have not measured how much that is.
- **Registries below the second level are not followed**, because of the unrolled recursion.
- **We do not index `ETHRenewerV1`**, which the guide says renews names that have not migrated yet. So
  renewals of v1 names since the cutover are missing from the nest. The last renewal we hold was at
  09:09 UTC on launch day.
- **There are no v2 entities.** The guide keys domains by `resource` and records by `recordId`, through
  `Linked`. We serve the events those are built from, not the entities themselves.
- **The full `Domain` and `Registration` lists from v1 do not fit.** Built at request time over every
  name, they exceed the nest's 2 GB memory budget. What we serve today is the event history, analytical
  SQL over it, and one name's state at a time.
- **Text values before 2023 are not there.** Earlier public resolvers emit the text key without its
  value, and reading the value needs a contract call.

## What it costs to run

The nest runs on a ThinkPad, on a stock nuthatch 5.17.0 build, polling mainnet every 60 seconds. On 4
November it was at the chain tip, with 319 MiB resident and 5.4 GB of sealed segments on disk. Most
queries in this post answered in 1.2 to 2.0 seconds. A few take longer: asking `information_schema`
for its table list ran into the 29-second limit, which tells you something about 157 tables and nothing
good about our catalogue.

## What we would still like to fix

In order of what each would add:

1. **The v2 mapping source.** With it, the v2 entities can be built from these same events and checked
   against the chain, as v1 was. If you work on ENS and can share it, we would like to hear from you.
2. **`ProxyDeployed` discovery and `ETHRenewerV1`**, which close the two gaps the guide names.
3. **A v2 parity run**: random names, rebuilt from events, compared with `eth_call` at one block.

None of these needs anything new from nuthatch. They are configuration and SQL, which is to say, the
dull part. We will do it next.
