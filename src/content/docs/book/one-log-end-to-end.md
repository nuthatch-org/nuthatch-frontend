---
title: "Appendix A. One log, end to end"
description: "A close reading of the path from an RPC log to a row that survives sealing and can be queried."
order: 11
---

The architecture becomes less mysterious when reduced to one ordinary event. Take a real one: USDC
emitted a `Transfer` log at index 663 of block 26,128,681 on Ethereum mainnet, 135 USDC from
`0x58df…47af` to `0x64cd…9a53`, at 20:52:47 UTC on 2026-10-05. The transaction succeeded, the
receipt holds the log, and the chain's RPC can return it through `eth_getLogs`. What must happen
before a reader can safely ask Nuthatch for that transfer?

The short answer is fetch, route, decode, order, persist, then eventually seal. The longer answer
is worth knowing because each verb protects a different invariant. The figures below come from
running the released 4.10.1 binary on a laptop against two public mainnet endpoints, with a nest
scaffolded by `nuthatch init` for the USDC contract from 120 blocks behind the tip.

## 1. Fetch only a defined universe

The cursor has a registry built from the authored package. It knows the contract addresses and the
event topic hashes that it is prepared to decode. For a solo nest it asks the source for logs inside
a bounded block window. In a runtime with several mounts on the same chain, the cursor asks once
for the union of those filters and routes a returned log to every live nest whose registry matches.

The RPC response is not yet application data. It is untrusted transport input. It may arrive out of
order, it may include logs useful to another mounted nest, and an endpoint may reject a window or
return a response too large for its local limits. The cursor's retry, window-sizing and concurrency
policy exist here. They deal with the ordinary weather of RPC infrastructure before a row reaches
durable storage.

An empty result still matters. The cursor must advance over a block range with no selected events,
otherwise it would return to the same quiet range forever. Progress is about blocks successfully
accounted for, not merely rows received.

`eth_getLogs` is not the only read. Block timestamps, which this nest indexes by default, cost one
`eth_getBlockByNumber` per block that produced a row, a round trip of their own; where the nest
declares `[extract] l1_blocks`, those headers also supply the L1 block each settled against. The
cursor reads the tip and the hashes of its checkpoints as well, and declared contract reads, IPFS
documents or extracted calls add requests of their own.

As run: `init` resolved USDC's ABI through its proxy via Sourcify and wrote the nest in 4.4 s. `dev`
reported `finality Depth(64), window 20`, had the API live within 0.2 s of starting, and announced
`cold start: backfilling from block 26128556 (tip 26128677)`. Eight seconds later it was `caught up
to tip at block 26128678 - 17881 events in 8s, 2321 ev/s`, seventeen tables' worth of rows across
122 blocks, with the adaptive window reporting 22 blocks by the end. Eighteen seconds from an empty
directory to a live, caught-up index is what the first-run promise looks like on a quiet afternoon.

## 2. Route and decode with a pinned registry

For the transfer log, the registry looks at the emitting address and topic zero, identifies the
`Transfer(address,address,uint256)` decoder from the vendored ABI, and decodes indexed and data
fields into a typed row. It also supplies the implicit chain columns: block number, block hash,
block timestamp (on unless the nest was scaffolded with `--no-timestamps`), transaction hash, log
index, address and a sequence number. There is no transaction index column; order within a block is
the log index, which is block-wide. The row for our transfer, read back from
`/table/fiat_token_v2_2__transfer`, carries exactly those: `block_number` 26128681, `block_hash`
`0x627b…5b50`, `block_timestamp` 1791233567, `tx_hash` `0xaca1…10c8`, `log_index` 663, `address`
the USDC contract, and then `from`, `to` and `value` as the ABI names them.

No schema inference happens at this point. The table layout was generated from the nest's inputs.
An unknown event is not invited to become a new column because it happened to look interesting.
Likewise, a malformed log does not earn a creative interpretation. The point of a pinned registry
is that the mapping from byte sequence to row is reviewable and repeatable.

Factories add one wrinkle. A factory event can discover child contracts which should be indexed
thereafter. On the ordinary path, discovery happens inside the one decode pass, log by log in chain
order, so a child created earlier in a window is known by the time its first log is reached. The
direct-seal backfill asks by address instead: it fetches a window for the base contracts and every
child known so far, decodes it, and fetches the same window again for any child that decode
discovered, repeating until a pass discovers nothing new, which is what catches a factory's factory.
Only then is the whole window decoded with every child known, and that decode is the one kept. Once
the children outnumber what an address filter can sensibly carry, it switches to one fetch by topic
alone, filtered locally, unless the endpoint refuses such a query. The final row path remains the
same in every case. Discovery is not allowed to become a second, differently behaving
decoder.

## 3. Establish a canonical local order

Providers are not entitled to return equivalent log sets in the same order. Nuthatch therefore
sorts decoded rows by chain coordinates before writing or sealing. The ordering is block number,
then log index, and the sealer breaks a tie on the row's canonical bytes; there is no transaction
key, because the log index already orders a whole block. This is not cosmetic. A view calculating
a balance, a factory registry or a content-addressed segment must behave the same when two RPC
endpoints return the same chain facts in different sequence.

This is also why concurrent backfill needs care. Fetches may happen in parallel, but their results
must enter the sealing path in deterministic block order. Otherwise speed has changed the bytes of
historical storage, and a supposedly content-addressed result has become dependent on timing. That
would be a rather expensive way of saving a few seconds.

## 4. Commit to the hot store

For an unfinalised block, the sorted row is written to the dataset's hot store alongside the cursor
checkpoint. The write establishes two things together, in one transaction: the window's rows, the
hash of its last block and the new last-block mark all land or none do. The transfer is then
visible to live reads, and the cursor has evidence of which chain block it believes it processed. A
later reorg check compares that evidence with the chain's current answer.

Derived views and incremental state receive the same event in this phase. Their update is part of
the reversible hot path. If the log later belongs to a discarded branch, the rollback replays its
effect with the opposite weight or rebuilds the affected hot state. A derived answer is therefore
not permitted to outlive the raw event it depends upon.

## 5. Seal after finality

Once block 26,128,681 sits 64 blocks behind the tip it may be sealed, but it is not sealed yet.
The sealer cuts a segment when the finalised rows held reach 20,000 or 64 MiB, or when they span
the chain's seal span of 1,800 blocks; until then they stay in the hot store, with a checkpoint
pinned at the finalised ceiling so a later reorg walk cannot step past the watermark. In the run,
the nest had 14,403 transfer rows across 126 blocks and had sealed nothing, which `/ready` reported
as `sealed_through: 0` beside `last_block: 26128681`.

When the cut comes, Nuthatch serialises the rows into a content-addressed Parquet segment, written
to a temporary name, fsynced and renamed into place, and only then rewrites the catalogue and swaps
it in with one rename. The hash is computed from the bytes before they are written; re-hashing
the file is the job of the startup integrity pass, not of the seal. The same hot-store transaction
that advances the sealed watermark prunes the matching hot rows. The event is no longer subject to
ordinary reorg rollback. On a fork of mainnet where the clock could be advanced, the same nest
configuration reached its span cut at block 26,130,493 and wrote
`fiat_token_v2_2__transfer-2d2d37dd….parquet`, 1,800 blocks of transfers in 32,940 bytes, then
advanced the watermark on through the empty finalised tail to 26,130,693.

`--seal-direct` uses the same sealed representation for old, already-final history, bypassing the
hot store during an initial bulk backfill. It still resolves every declared `[[calls]]` input at its
pinned block before it commits the segment. It is an optimisation with an important precondition:
the range must be past finality. It does not use a fast path to omit declared inputs or declare
recent, reversible blocks permanent.

## 6. Answer a query with provenance

When a reader asks for the transfer or runs SQL over its table, the serving layer reads sealed
segments and the hot tail as one logical surface. The response carries watermarks and source
information so a caller can tell how current the answer is and whether the hot contribution was
available. A count over the table in the run came back with `provenance` naming `as_of` 26128681,
`sealed_through` 0, `source` `hot+sealed`, the registry hash `0xce63…f128` and the nest's NID, and
with `tip_unavailable: false`. A hot-store failure must not quietly make a query look complete
while returning only sealed history. A hot scan that fails answers from sealed rows alone with
`tip_unavailable: true`, which is the field to read, and since 4.11.0 `source` agrees with it and
says `sealed`; up to 4.10.1 it still said `hot+sealed` (nuthatch #1935). `degraded` stays false in
that case, because it reports incomplete sealed history, not a missing tip.

That final detail is representative of the design. A Nuthatch answer is useful not only because it
contains a number, but because it can say which package decoded it, how far the cursor had reached
and what portion of history was sealed when the answer was formed.
