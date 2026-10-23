---
title: "6. Maintaining an answer"
description: "Why v3 adds authored incremental entities without pretending that every SQL view is one."
order: 7
---

An indexer has two chances to pay for a calculation. It can wait until somebody asks, scan the facts
then, and return the result as a view. Or it can do a little work for each arriving block, retain a
bounded answer, and make the later read cheap. Neither is universally better. The first is flexible;
the second is useful precisely because it is constrained. Between them sits a compromise: pay the
whole of the first price, but pay it once the data has changed rather than when somebody asks, and
keep the result.

Nuthatch 3.0 makes that choice available to a nest author through an **authored incremental entity**.
It is the first release in which the author, rather than only the built-in balance circuits, can say
that a relation should be maintained during indexing.

## Three kinds of authored SQL

An ordinary `views/*.sql` file contains `CREATE VIEW`. It runs on the hot and sealed query surface when
a reader asks for it. It can use the broad read-only SQL surface. It has no permanent state and does
not affect ingest. This is the sensible default.

A view can also be listed in `maintained.toml` (4.14.0), with a `[[view]]` entry naming it. The
view's SQL is unchanged. After a commit or seal reaches the tip, off the indexing path, the nest
evaluates it exactly as a request would and stores the answer under `maintained/<view>/`, keyed on
a hash of everything the evaluation read: the binary and engine, the authored files, and the schema,
sealed segments and hot rows of the tables it reaches. A request reads the stored copy only when its
own inputs hash to that key, and otherwise computes as before, so a copy cannot be stale and cannot
differ from the view it stands in for. A newer state always wins over a build still queued for an
older one. What it cannot do is cover inputs its key does not: a view that reaches an incremental
entity, an offchain snapshot, the label snapshots, a factory's children view or a volatile function
is refused at load, by name. It is a copy of a whole answer, recomputed whole, and it gains none of
an entity's incremental behaviour.

An entity has one `SELECT` in `entities/` and a declaration in `entities.toml`. That declaration gives
the result a key and a maximum row count. Nuthatch compiles the admitted subset to an incremental
circuit and feeds it facts as they arrive. The relation can be queried through SQL or read by key.

The distinction stops a pleasing but false sales pitch. Naming a view does not make it incremental,
and nor does maintaining one: a maintained view is still the full query, run sooner. An entity is
incremental, but it gains that property by accepting resource limits and less SQL, not by attaching
an adjective to a SQL query.

## Why the restriction earns its keep

Incremental maintenance must be able to add a block and retract a block without rescanning all earlier
ones. Projection, filtering, exact arithmetic, grouping, supported aggregates and inner equijoins have
that shape. `ORDER BY`, `LIMIT`, window functions, outer joins, `DISTINCT`, percentiles, recursive
queries, `HAVING`, common table expressions and `count(x)` as opposed to `count(*)` do not belong in
the first safe subset. They remain valid questions for views.

The row bound is equally important. A maintained answer is state retained at the cursor, alongside
the chain's hot data. `max_rows` participates in admission rather than being a hopeful comment, and
it bounds more than the answer: it caps the **live input rows** the circuit retains, summed across its
input relations, including while it seeds on restart. A `count(*)` grouped into a handful of rows can
still retain thousands of inputs, so size `max_rows` for the inputs, not only the result. Past it, the
entity faults and the nest is quarantined. An answer that has stopped
being maintained must not continue to be served as current.

## The lifecycle is still one circuit

During backfill, tip following and a reorganisation, the same relation receives facts. A reorg feeds
the removed facts with negative weight, so no bespoke author rollback can drift from the forward path.
After a restart, the relation is seeded from sealed segments and the hot tail already held locally. No
historical RPC replay is involved.

This is observable. Each entity has applied-through, current, row-count, state-bytes, faulted,
unavailable and seconds-since-progress metrics, labelled by nest and entity. The row count is the
answer's rows, not the input rows `max_rows` bounds, so the two are not the same number. The
reader's provenance and the operator's metrics answer the same question from opposite ends: is this
result current, and if not, why are we still looking at it?

One ordering detail was wrong until 4.10.1 and is worth knowing because it is the kind of thing a
circuit makes easy to get wrong: a window's facts were applied to the entity before the hot store
had committed them, so for a moment the entity's watermark ran ahead of what `/sql` could read,
and a window whose commit then failed had been folded all the same. The entity now applies a window
only after the store has it.

There is one deliberately blunt limitation, introduced in 3.0 and still standing. `--seal-direct`
bypasses the ingest route used to maintain entities, so it is refused for a nest declaring one. It
is better to reject an unsupported fast path than to finish a backfill with an elegant, empty
answer.

The practical authoring details are in the [entities guide](/docs/build/entities/), and maintained
views sit beside them in [authoring modes](/docs/concepts/authoring/). The next chapter
returns to identity, where changing an entity definition has different consequences from changing the
facts beneath it.
