---
title: "3. The cursor"
description: "How Nuthatch backfills, follows the tip and handles a chain that can briefly disagree with itself."
order: 4
---

An indexer has two jobs which look similar from a distance and behave very differently in practice.
It must collect old history, often millions of blocks, and it must then follow a live chain whose
latest blocks are not yet final. Nuthatch calls the durable position that coordinates this work a
cursor.

There is one cursor per chain in a runtime. Not per HTTP route, not per tenant and not per nest.
That is a useful constraint, not a missing feature. One chain has one ordered tip, one finality
boundary and one reorganisation story. Giving every nest an independent opinion about those things
would multiply RPC work and make recovery needlessly inconsistent.

## Backfill is a controlled walk through history

For a newly mounted nest, Nuthatch begins at the earliest start block its contracts declare and asks
the RPC for logs in bounded windows. (A nest that declares none starts 5,000 blocks behind the tip,
and `--backfill N` overrides either.) Providers impose limits on ranges, result counts and
concurrency, so the process does not assume that a heroic `getLogs` call will be welcome. It splits
work into windows, retries within its policy and records progress only after the rows have been
accepted by the hot store: a window's rows, its block-hash checkpoint and the new last block land in
one transaction, so there is no moment at which the store claims a block it does not hold.

The details matter because RPCs are prone to giving an answer that is technically valid and
operationally useless. A provider may time out, cap a response, or make a 10,000-block request feel
like a personal insult. The window therefore adapts: it starts from the chain's measured default,
shrinks when a request is refused or, since 5.18.0, when a range of more than one block goes
unanswered within the client timeout, and grows back when requests succeed, and `--window` is the
ceiling an operator places on that. A provider can also object to the filter rather than the
range: publicnode on BNB Chain and Polygon refuses a request naming ten or more addresses, and since
4.11.0 that is recognised as a refused filter rather than misread as a credentials failure, and the
address list is split in halves until a request is accepted. Concurrent fetching is reserved for the direct-seal backfill of
history already past finality; the ordinary walk is one window at a time, because its results must
enter the hot store in order. Faster is useful, but only if every accepted block remains attributable
and repeatable.

A window can carry more than logs. Where the nest declares `[extract] l1_blocks`, the cursor also
fetches the header of every block that produced a decoded row and records the L1 block it reports.
A header without that field refuses the whole window rather than storing a zero, because a row
that says "settled against L1 block 0" is a lie with a plausible shape.

Backfill catches a nest up to the present. It does not establish that the present is permanent.

## The tip is provisional

At the chain tip, a block can be replaced by a competing block. This is a reorganisation. A reader
who saw an event in the first branch must not be left with that event after the chain selects the
other branch. Nuthatch therefore keeps unfinalised data in its hot store, with enough block-hash
checkpoints to notice when the chain no longer agrees with the path it had followed.

When a mismatch is detected, the cursor finds the fork point and each affected hot store rolls back
to that point. It then indexes forward along the winning branch. The invariant is not “we never
briefly served a provisional result”. No honest near-tip system can promise that. The invariant is
“provisional rows are marked by their place in a reversible part of the pipeline, and the store
converges to the canonical chain.”

Finality is what ends that reversible period. Once a block sits sufficiently behind the head under
the configured chain policy, Nuthatch can seal it. Sealed history is no longer subject to ordinary
tip rollback and becomes the cold, durable half of the query surface.

## One chain, one source of ordering

In a multi-nest runtime the cursor obtains the union of needed logs and routes them to the nests
that own their address and event signature. A log may be relevant to more than one nest, in which
case each gets its own decoded rows. Fetching is shared; the nests' datasets are not silently
merged. This distinction keeps ownership and rollback manageable while avoiding N copies of the
same RPC polling. One consequence is worth knowing when sizing a runtime: a factory nest cannot
name its children's addresses in advance. Since 4.11.0 a cursor hosting one asks by the factory's
address and every child discovered so far, rediscovering as it goes, until the union passes 500
addresses; past that it fetches by topic alone, and the whole union loses its address filter. Its
neighbours then pay, in logs fetched and discarded, for the factory's open-endedness. An endpoint
that refuses an address-less `eth_getLogs` keeps the cursor asking by address whatever the count.

Different chains need different cursors. They have different heads, different finality rules and
different failure domains. A runtime can host them, but it does not pretend that Arbitrum and
Ethereum form one sequence merely because they have both inconvenienced the same operator.

The cursor is the reason an index can say where it is. The next chapter is about where the data sits
once it has passed through that cursor, and why it lives in two forms.
