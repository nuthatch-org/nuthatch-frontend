---
title: nuthatch.toml
description: The one config file a nest has - the [nest] header and one or more [[contracts]].
order: 1
checked: 5.9.0 (2026-10-23)
---

A nest starts with `nuthatch.toml`. `init` generates it from a contract address; you
edit it to add contracts, events, factories, and the optional compliance and webhook stages.
`schema.json`, `llms.txt` and the footguns in `semantic.toml` are *derived* from it and the ABIs -
regenerate them with `nuthatch schema`. Views, semantic descriptions and the optional declaration
files are yours to author, and `schema` leaves them alone.

## The shape

```toml
[nest]
name = "usdc"
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://your-rpc", "https://a-fallback-rpc"]

[[contracts]]
alias = "usdc"
address = "0xA0b86991c6218b36c1D19D4a2e9Eb0cE3606eB48"
start_block = 6082465            # auto-detected at init
abi = "abis/usdc.json"
events = ["Transfer", "Approval"]  # empty = index every event the ABI defines
```

## `[nest]`

| Field | Meaning |
| --- | --- |
| `name` | The nest's name (used for the served surface and logs). |
| `chain` | The chain name, e.g. `mainnet`, `arbitrum-one`, `base`. |
| `chain_id` | The chain id, e.g. `1`, `42161`, `8453`. |
| `rpc_urls` | RPC endpoints, tried in order with round-robin failover. Point at your own node. |
| `schema_version` | The config and data layout version, written by `init` and managed by nuthatch. |
| `block_timestamps` | Whether rows carry `block_timestamp` (default `true`). Set at `init`; see [`block_timestamps`](/docs/reference/config/#block_timestamps). |

## `[[contracts]]`

One block per contract. Repeat it to index many contracts in one nest.

| Field | Meaning |
| --- | --- |
| `alias` | Short name - the table prefix (`{alias}__{event}`). |
| `address` | The contract address. |
| `start_block` | Deployment block (auto-detected at `init`); omit to backfill from a recent tip offset. |
| `abi` | Path to the vendored ABI, relative to the nest dir. |
| `events` | Optional allowlist of event names to decode. Empty indexes **every** event the ABI defines. |

> The `events` allowlist is how a nest indexing e.g. a token keeps only `Transfer` instead of millions
> of irrelevant rows. An event name here that the ABI doesn't define is a config error, caught when the
> decode registry is built.

## Optional stages

`nuthatch.toml` also carries the optional layers, each documented on its own page:

- `[[templates]]` + `[[factories]]` - index dynamically discovered children. See [Factories](/docs/build/factories/).
- `[flags]` + `[[alerts]]` - the compliance pack. See [Compliance pack](/docs/build/compliance/).
- `[[webhooks]]` - POST sealed rows to a URL. See [Webhooks](/docs/build/webhooks/).
- `[[calls]]` + `[[ipfs]]` - pinned contract reads and verified IPFS documents. See [Contract calls and
  IPFS documents](/docs/build/contract-calls/).
- `entities.toml` - bounded keyed relations maintained as blocks arrive. See [Authored incremental
  entities](/docs/build/entities/).
- `maintained.toml` - views kept as stored copies of their own answer, rebuilt as the chain moves. See
  [Maintaining an answer](/docs/book/maintaining-an-answer/).

Absent stages cost nothing - a nest with none of them is a plain, fast log indexer.

## Address-history nests

A nest can instead follow a set of accounts rather than contracts: declare `[address_history]` and
no `[[contracts]]`. It records the transactions, internal transactions, token transfers, withdrawals
and produced blocks that touch each watched address, and serves them Etherscan-shaped at `/api`.
This is a separate mode, not an optional stage: no decode, no views, no sealing.

```toml
[nest]
name = "accounts"
chain = "mainnet"
chain_id = 1
rpc_urls = ["https://your-rpc"]

[address_history]
addresses = ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"]  # clients can add more through /api/watch
start_block = 17030000   # history before this is never fetched
poll_interval = "5m"     # the default
```

```sh
nuthatch dev --dir accounts --trace-rpc https://your-trace-rpc
```

`--trace-rpc` (or `NUTHATCH_TRACE_RPC`) names the endpoint asked for `trace_filter`, which finds
internal transactions; it defaults to the nest's RPC. An address-history nest runs only as a solo
`nuthatch dev --dir`, never mounted in a runtime or under `serve`. Running it for rotki, with the
optional mirror and MEV settings, is on the [rotki page](/rotki/).

## Next

- [ABIs, events &amp; tables](/docs/build/tables/) - how config becomes SQL tables
- [Authored SQL views](/docs/build/views/) - add derived logic
- [Configuration reference](/docs/reference/config/) - every field, `nuthatch.toml` and `mounts.toml`
