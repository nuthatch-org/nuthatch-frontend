---
title: ABIs, events & tables
description: How decoded events become SQL tables - one table per event, with implicit columns.
order: 2
checked: 5.4.0
---

Nuthatch is a log indexer: it turns a contract's **events** into **SQL tables**. This page explains the
mapping.

## ABIs

At `init`, nuthatch resolves the contract's ABI - **Sourcify first, then keyless Blockscout, then Etherscan if `ETHERSCAN_API_KEY` is set** - and
**vendors it** into `abis/`. From then on the ABI is a local file; nuthatch never re-fetches it at
runtime. A `DecodeRegistry` is built from the vendored ABIs at startup: `topic0` → event decoder,
filtered by contract address.

If a contract is a proxy, edit the `abi` path in `nuthatch.toml` to point at the implementation's ABI.

## One table per event

Every declared event becomes a table named `{alias}__{event_snake_case}`. For a contract aliased `usdc`
with a `Transfer(address from, address to, uint256 value)` event, you get a table `usdc__transfer` with
columns `from`, `to`, `value`.

The table exists even before that event has fired. It resolves as an empty typed view, so an authored
view may safely refer to a rare event from the first run rather than failing to load until the first
matching log happens to arrive.

## Implicit columns

Every table also carries the same implicit columns, before the event's own fields:

| Column | Meaning |
| --- | --- |
| `block_number` | The block the log was in. |
| `block_hash` | The canonical block hash (a reorg checkpoint). |
| `block_timestamp` | The block header timestamp. |
| `tx_hash` | The transaction hash. |
| `log_index` | The log's index within the block. |
| `address` | The emitting contract (distinguishes children sharing a table - see factories). |
| `_seq` | A single monotonic per-row ordering key, derived deterministically from `(block, log_index)`. |

## Column types

Decoded fields keep their Solidity types. Wide integers (`uint256`, and anything over 64 bits) are
stored as an exact decimal string, with a derived `{col}_dec` DECIMAL column for numeric use and a
`{col}_overflow` boolean beside it. A value over 38 digits exceeds `DECIMAL(38,0)`: its `_dec` is NULL
and `_overflow` is true, so `SUM({col}_dec)` is the sum of the values that fit, and `WHERE NOT
{col}_overflow` says so. There is no exact substitute in SQL: `HUGEINT`, which Burrmill accepts, is
signed 128-bit, so it overflows at the same order of magnitude, and `DOUBLE` holds any size but loses
precision past about 15 digits. Keep the decimal string when exactness matters.
See [The SQL surface](/docs/reference/sql/).

## Regenerating

`schema.json` (the machine-readable list of tables + columns) and the AI surface (`llms.txt`, semantic
footguns) are derived from `nuthatch.toml` + the ABIs. After editing config, regenerate them:

```sh
nuthatch schema
```

The live registry is authoritative at runtime. Since 2.7.0, a stale `schema.json` no longer hides
columns which the current config and ABI declare, and the startup message explaining why a hand edit
did not regenerate the file is visible at the default log level. Regenerate it anyway. Consumers of
the checked-in artifact should not have to depend on runtime repair.

## Next

- [Authored SQL views](/docs/build/views/) - derive answers over these tables
- [Factories](/docs/build/factories/) - index children that share a table
- [The SQL surface](/docs/reference/sql/) - querying, and the big-int columns
