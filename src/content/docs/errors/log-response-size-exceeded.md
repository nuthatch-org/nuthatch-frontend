---
title: "Log response size exceeded"
description: "Alchemy's eth_getLogs refusal, -32602 Log response size exceeded: what its limits are, how to page around it, and what a nest does with the range it suggests."
order: 2
checked: 5.24.0 (2026-11-22)
---

```text
Log response size exceeded. You can make eth_getLogs requests with up to a 2K block range …
```

This is Alchemy, code `-32602`, as quoted in
[ethers.js issue #4703](https://github.com/ethers-io/ethers.js/issues/4703); the message goes on to
name a block range that would have worked, in brackets. Alchemy sends it as an HTTP 400 with the
JSON-RPC error in the body, which matters for clients that look only at the status.

## Why it happens

Alchemy caps a call two ways at once, and a request has to fit one of them. On pay-as-you-go plans, a
call succeeds if it covers at most 10,000 blocks, or if it covers any range and returns 10,000 logs
or fewer, under a 150 MB response limit; the free tier allows a much smaller range
([Alchemy support](https://support.alchemy.com/articles/1883074130-why-do-i-see-a-free-tier-error-when-calling-eth-getlogs-with-a-large-block-range)).
Alchemy's own guide gives 2,000 blocks for the no-cap case on Ethereum
([Deep dive into eth_getLogs](https://www.alchemy.com/docs/deep-dive-into-eth_getlogs)). The
figure in the message has moved with the limits: the issue above quotes 2K, and the copy nuthatch's
tests keep of an Alchemy refusal says `up to a 10,000 block range`. A wide range over a busy contract
fails both tests.

## The fix without Nuthatch

The message tells you what to ask for next. Parse the `[0x…, 0x…]` range out of it, ask for exactly
that, then continue from the block after its end. If you cannot parse a range, halve the window and
retry. Filter by `address` and `topics[0]` so the 10,000 logs are the ones you want, and store what
you fetch keyed by `(transactionHash, logIndex)` so retries do not duplicate it.

## What a nest does

nuthatch reads the error body on an HTTP 400 as well as a 200, so this refusal is recognised as a
range too large rather than a bad request. `nuthatch dev` halves the window and asks again from the
same block until it is served. A `--seal-direct` backfill uses the range in the message: when it
starts where the request did and ends before it, the range is split exactly there, the first piece
being what Alchemy said it would serve, and the rest is asked for separately. Either way the width that
was served becomes the window's ceiling, and the backfill carries on without a restart.
[query returned more than 10000 results](/docs/errors/query-returned-more-than-10000-results/) has a
measured run of the same loop.

`nuthatch doctor --rpc <your Alchemy URL> --address 0xADDR` measures the window your plan actually
serves before a backfill finds it out, and prints a `--window` to start from.
