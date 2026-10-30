---
title: "Appendix B. A reorganisation, walked through"
description: "A concrete hot-store rollback, the shared-cursor fan-out, and the line Nuthatch will not cross."
order: 12
---

Reorganisations are where an indexer either demonstrates that it understands a blockchain or
quietly begins preserving fiction. The normal case is recoverable precisely because Nuthatch keeps
the recent part of history hot and reversible.

Consider a cursor that has processed blocks 100 through 110. Its finality policy has sealed through
block 104. Blocks 105 through 110 remain in the hot store, along with block-hash checkpoints. A
transfer in block 108 has incremented a derived balance view. At this instant that is a valid,
useful result, but it is not yet final.

## The chain changes its mind

On the next poll, the cursor obtains a head which does not agree with its recorded checkpoint for
block 110. It walks backwards through the known checkpoints and the source's current block hashes
until it finds the deepest common ancestor. In this example, block 106 still agrees; blocks 107 to
110 were replaced. The ancestor is 106.

The cursor does not try to patch individual logs based on a hunch. It performs a rollback to the
ancestor. The hot store deletes rows above 106, resets its last-block metadata to 106 and removes
the checkpoints that belonged to the old branch. The derived balance view retracts the effect of
the former transfer in block 108. Factory child discovery that occurred only on the discarded
branch is rolled back as well. The cursor then starts again at 107 and indexes the canonical
replacement blocks in the normal path.

The application may have observed a provisional balance before the rollback. That is inherent to
serving near-tip data. What Nuthatch promises is convergence: once it notices the reorg, neither
the raw table nor a maintained derivation may retain the old branch.

That is the example. Here is the same thing run on the released 4.10.1 binary, on 2026-10-05,
against a local fork of mainnet with a one-second poll. Three USDC transfers to the burn address
were sent in blocks 26,128,700, 26,128,703 and 26,128,706, and the built-in balance circuit showed
the burn address at 8,000,000 units. The fork was then reorganised five blocks deep, replacing
26,128,705 onward with empty blocks, which discarded the third transfer. The tip came back at the
same height, so no poll saw it move, and the rollback arrived on the idle re-check 9.8 seconds
later: `reorg detected: rolled back to block 26128702 (removed 2 entities)`. Two things in that line
are worth a second look. The ancestor is 26,128,702, not the true fork point of 26,128,704, because
the hot store keeps one checkpoint per committed window and the walk stops at the deepest stored
checkpoint that still matches; the cost is re-fetching two blocks that had not changed. And the
rollback removed two rows, the discarded transfer and the surviving one in 26,128,703, then
re-indexed forward and put the survivor back. The balance read 3,000,000 afterwards,
`nuthatch_reorgs_total` read 1, and the discarded row was gone from the raw table.

## Shared cursor, many datasets

Now place three nests on the same chain cursor. The cursor detects the hash disagreement once at
its shared boundary, then fans the rollback out to every live dataset. Since 5.14.0 the fan-out is a
marker: extraction drops the buffered windows above the ancestor and leaves it, and each nest rolls
back from its own position when it next reads, with the same rollback a lone nest runs. Each dataset may have a
different sealed watermark because it may have been mounted at a different time or progressed
differently. A nest already at or below the ancestor does nothing. A nest whose hot range contains
the discarded blocks retracts them. If one nest cannot roll back, it is quarantined rather than
making the other datasets lie about their state.

This is why a shared cursor does not require shared mutable tables. Fetching and reorg detection are
shared chain work. Row ownership, store mutation and local failure handling remain per dataset.
The structure is slightly more machinery than one giant database, but much less machinery than
trying to explain which tenant's rows were inadvertently removed by a global repair.

## The finality line

Return to the example. A reorg to ancestor 106 is repairable because the seal watermark was 104.
Every affected block is still in the reversible hot layer. But imagine the source reports an
ancestor of 102. Blocks 103 and 104 have already been sealed as immutable history. Deleting only
the hot rows above 104 would leave sealed data from the discarded branch in the query surface.

Nuthatch refuses this condition. It reports a finality violation and halts the affected index rather
than silently presenting a half-correct history. A single nest run with `nuthatch dev` exits; in a
runtime the nest is quarantined as a terminal fault, named on `/nests` with its reason, and its
siblings on the same cursor carry on. This is not a graceful recovery in the marketing sense. It is
the only honest behaviour once the external finality assumption has been violated. The operator
must investigate the chain source, finality configuration and recovery procedure instead of
allowing a plausible but inconsistent index to keep serving.

On the same fork, the same nest was left to seal: with the clock advanced 2,048 blocks it cut a
segment spanning 1,800 blocks and advanced its watermark to 26,130,695. The fork was then
reorganised 80 blocks deep, to an ancestor of 26,130,679, with one replacement transaction so the
new branch genuinely differed, and one block was mined on top so the next poll would see the tip
move. 0.65 seconds after the reorganisation was issued the log read `no checkpoint at or below
block 26130759 is canonical`, because each window commit prunes the checkpoints below the newest one
at or below the sealed watermark, and then: `a fork deeper than every checkpoint this nest holds is below the
sealed/finalized watermark 26130695 - a finality violation this indexer cannot repair; halting.
Raise the chain's finality depth.` The process exited with that line. Nothing was deleted, nothing
was rewritten, and the catalogue still names the segment the abandoned branch produced, which is
what the operator will need when deciding what to do next.

Detection is not instantaneous. The cursor learns that the chain changed when a reorg check runs, and
until then it answers from what it last indexed, as it does for an ordinary reorg near the tip. A check
runs when a poll sees the tip move; a fork that keeps the tip height is re-checked on the first poll at
least twelve seconds after the last check: every twelve seconds for a nest polling that often, every five
minutes at the default since 4.15.2. A failing RPC delays it further, so there is no fixed bound. The two runs above
show both ends of that: 0.65 seconds when the tip moved, 9.8 seconds when it did not. Measured once
before, on 3.13.3 against a forked chain at a one-second poll interval, the sealed rows of the abandoned
branch were served for about half a second before the halt. No read-time setting removes the window,
because below the seal the discarded rows are the sealed ones. A finality depth the chain honours is
the only protection.

The same line applies to direct sealing. That fast backfill path only processes a range already
behind the finality boundary. Its performance comes from avoiding hot writes, not from relaxing the
definition of permanent history.

## What to look for in practice

`nuthatch_reorgs_total` records ordinary detected reorgs. A nest's `/ready` exposes the last indexed
and sealed watermarks (`last_block`, `sealed_through`); in a runtime that is `/<name>/ready`, while
the root `/ready` says only whether the whole is ready and which nests are quarantined or stalled.
`/health` is bare liveness and says only `ok`. A sudden tip lag accompanied by reorg growth calls
for a look at the source and chain conditions. A finality violation is a hard incident, not a
counter to wave away.

The important operational habit is to distinguish “we are behind” from “we are wrong”. Being behind
can often be fixed by an RPC change or smaller windows. A reorg below seal means the system has
lost the ability to correct historical facts automatically, and it should be treated accordingly.
