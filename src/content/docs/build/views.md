---
title: Authored SQL views
description: General SQL authored with a nest and evaluated when a reader asks for it.
order: 3
checked: 5.3.3
---

A nest's **logic layer** is authored SQL: `CREATE VIEW` statements over your decoded tables, kept in the
nest's `views/` directory. This is where a nest computes derived answers - the difference between "a
table of raw events" and "a nest that answers a question."

## Where they live

`init` scaffolds a `views/` directory with a commented starter. Drop `*.sql` files in it; each is a
`CREATE VIEW` over your nest's tables. Views run against the **live tip ∪ sealed** SQL surface, so
they span all of history - hot and cold - seamlessly.

```sql
-- views/active_traders.sql
CREATE VIEW usdc_active_traders AS
SELECT lower("from") AS trader, COUNT(*) AS transfers, MAX(block_number) AS last_seen
FROM "usdc__transfer"
GROUP BY 1
ORDER BY transfers DESC;
```

Query it like any table: `nuthatch sql "SELECT * FROM usdc_active_traders LIMIT 20"`. A file dropped
into `views/` is read on the next query; a running `dev` needs no restart.

## Validated and drift-gated

Authored views aren't just dropped in and hoped over. They're a first-class layer:

- **Validated** - each view binds against the schema at load, so a column that moves out from under it
  is a loud `nuthatch check` failure, not a silent wrong number.
- **Described** - a view's meaning lives beside it in [`semantic.toml`](/docs/build/semantic/), surfaced
  through `/schema` and the MCP so an agent knows what it computes.
- **Drift-gated** - CI catches a view that no longer matches the schema.
- **Taught** - the builder skill teaches an agent to author them with real syntax, not hallucinated SQL.

## Views are not entities

Views are read-only `CREATE VIEW`s over already-sealed segments and the hot snapshot. Nothing about them
touches the deterministic ingest → decode → seal path - they are a *query-time* layer. That is why they
are safe to add, edit, and iterate freely, and why a costly view still scans its inputs every time it is
asked.

An [authored incremental entity](/docs/build/entities/) is the deliberate alternative for a frequent,
expensive keyed aggregate. It lives in `entities/` with a declaration in `entities.toml`, has a bounded
SQL subset and RAM budget, and is maintained as blocks arrive. Do not promote a view merely because it
looks important. Prefer the view unless measurements show that recomputation is the read-path cost.

## Recipes are views

The [recipes](/docs/build/recipes/) library (`total_supply`, `balances`, `reserves`, …) is just a set of
first-party authored views. `nuthatch recipe add <name>` drops one into `views/` - read it, edit it,
extend it; it's ordinary SQL.

## Next

- [Recipes](/docs/build/recipes/) - derive contract reads with no eth_call
- [Authored incremental entities](/docs/build/entities/) - pay for one repeated aggregate while indexing
- [The semantic layer](/docs/build/semantic/) - describe what a view means
- [The SQL surface](/docs/reference/sql/) - the query engine underneath
