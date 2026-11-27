---
title: "query timeout exceeded"
description: "Why eth_getLogs from block 0 times out on a public RPC, why a dashboard that re-scans on every refresh keeps hitting it, and what a nest does instead."
order: 4
checked: 5.24.1 (2026-11-26)
---

```text
-32005 query timeout exceeded
```

Infura documents this as the `eth_getLogs` answer when a query runs past its 10-second limit, under
the same code as `query returned more than 10000 results`
([Infura's eth_getLogs reference](https://docs.infura.io/reference/sei/json-rpc-methods/eth_getlogs/)).
Many endpoints do not send an error at all: the connection stays open until the client gives up, or a
proxy in front of the node closes it, and what you see is your HTTP library's timeout.

## Why it happens

The usual cause is a query from block 0 to `latest`. In ethers that is
`contract.queryFilter(filter, 0, 'latest')`, often written with `fromBlock` defaulting to 0. The node
has to look at every block since genesis, more than 20 million on Ethereum, even if the contract was
deployed last month. On a shared endpoint that is refused for range, refused for results, or simply
not finished in time.

It gets worse when the query sits behind a page. A dashboard that calls it on every load sends the
whole history scan again each time anyone opens or refreshes it.
[StabilityNexus/Windmill-EVM-WebUI#132](https://github.com/StabilityNexus/Windmill-EVM-WebUI/issues/132)
is this shape: three `queryFilter` calls from block 0 on each dashboard refresh, against public
endpoints.

## The fix without Nuthatch

1. Start at the contract's deployment block. Record it in your config, or find it once with a binary
   search over `eth_getCode`.
2. Walk from there to the head in windows the endpoint accepts (see
   [exceed maximum block range](/docs/errors/exceed-maximum-block-range/)), narrowing a window that
   times out.
3. Keep the results, with the last block you have, in a store of your own. On the next load fetch only
   the blocks after it.
4. Serve the page from that store, not from the RPC.

By step 4 you have written a small indexer, which is a reasonable thing to have.

## What a nest does

A nest is that indexer. `nuthatch init` finds the deployment block by binary search over `eth_getCode`
and writes it to `nuthatch.toml` as `start_block`; if the endpoint keeps no old state it prints
`deployment block undetected` and asks for `--start-block` rather than starting from 0.
`nuthatch dev` reads the history once, in adaptive windows, keeps it on disk, and follows the head
from there, so a restart resumes from the last block it has.

A window the endpoint cannot answer in time is narrowed, not retried whole. Since 5.18.0 that holds for
a request that gets no response within the client's 20-second timeout, as well as for one whose body
is too slow to read, and Infura's `query timeout exceeded` is read as a range too large. A single block
that still times out is waited on and retried, since it cannot be split.

The dashboard then reads the local copy, which answers without asking the chain:

```sh
nuthatch init 0xYourContract --chain mainnet --rpc https://your-endpoint.example
nuthatch dev
curl 'http://127.0.0.1:8288/sql?q=SELECT%20count(*)%20FROM%20yourcontract__order_filled'
```

The table name is the alias `init` chose and the event in snake case, so `OrderFilled` becomes
`order_filled`; `schema.json` in the nest lists every table. See the [HTTP API](/docs/reference/http-api/) for `/sql` and the per-event routes, and
[Serving](/docs/operate/serving/) for putting it behind a proxy when the page is public.
