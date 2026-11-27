---
title: "Free API access is not supported for this chain"
description: "Etherscan's free tier stopped covering BNB Chain, Base, OP Mainnet, Avalanche and Gnosis. What still works, how to replace the rest from an RPC, and what a nest serves."
order: 6
checked: 5.24.1 (2026-11-26)
---

```text
Free API access is not supported for this chain. Please upgrade your api plan for full chain coverage.
```

Etherscan's API V2 answers this when a free key asks about a chain outside the free tier
([Etherscan's error messages](https://docs.etherscan.io/resources/common-error-messages)). The free
tier was cut to about 90% of chains on 22 November 2025
([Etherscan](https://info.etherscan.com/whats-changing-in-the-free-api-tier-coverage-and-why)).
Etherscan's [supported chains](https://docs.etherscan.io/supported-chains) list marks BNB Smart Chain
(56), Base (8453), OP Mainnet (10), Avalanche C-Chain (43114) and Gnosis (100) as paid tier only;
Ethereum, Arbitrum One and Polygon stay free.

## Why it happens

It is a plan decision, not a fault in your key. The same key keeps working on the free chains.
Source code and ABI endpoints stay free on every chain, so `module=contract&action=getabi` still
answers. What stops on those chains is the rest: account history such as `txlist`, `tokentx` and
`txlistinternal`, and `module=logs`.

## The fix without Nuthatch

Pay for the plan, or move each call to an RPC:

- **Event logs** (`module=logs&action=getLogs`) are `eth_getLogs` under another name. Ask an RPC
  directly, in windows it accepts; the other pages here cover the errors that brings.
- **ABIs** come free from Sourcify or a Blockscout instance for most verified contracts, and from
  Etherscan's own ABI endpoint, which is still free.
- **An account's transactions and transfers** have no single RPC call. Token transfers are `Transfer`
  logs filtered on the account in `topics[1]` or `topics[2]`. Plain transactions and internal
  transfers need an archive node with tracing, and code that walks blocks to find the account's.

## What a nest does

Each of those three has a nuthatch answer, all from your own RPC.

**Event logs.** A nest indexes a contract's events into SQL tables once and keeps them current:

```sh
nuthatch init 0xYourContract --chain base --rpc https://your-base-endpoint.example
nuthatch dev
```

**ABIs.** `nuthatch init` tries Sourcify first, then a keyless Blockscout, and Etherscan only if
`ETHERSCAN_API_KEY` is set; `--abi path/to.json` covers a contract none of them has.

**Account history.** An address-history nest serves an account's history at `/api` in Etherscan's
`module=account` shapes, so a client that spoke to Etherscan can point at it instead. The repository's
[paywalled-chains example](https://github.com/nuthatch-org/nuthatch/tree/main/examples/paywalled-chains)
is one runtime for Base, BNB Chain and Gnosis:

```sh
nuthatch dev --dir ~/history
curl -X POST -H 'content-type: application/json' \
  -d '{"address":"0xYourAddress"}' http://127.0.0.1:8288/api/watch
curl 'http://127.0.0.1:8288/api?chainid=8453&module=account&action=txlist&address=0xYourAddress'
```

It finds an account's transactions from its nonce and balance and traces only the blocks where value
came in, so its RPC must serve archive state and `debug_traceBlockByNumber`. On 2026-11-03 Gnosis's
keyless endpoints did both; the keyless Base and BNB Chain endpoints did not, and those two need your
own node or a provider plan. The example's README lists what it does not answer: an account with
contract code gets `NUTHATCH_UNSUPPORTED` for `txlist` from the block it had code (on Gnosis it is
traced with `trace_filter` instead, where the endpoint serves it), and an incoming
transaction that moves no value is not listed. Answers are exact or refused, never short.
