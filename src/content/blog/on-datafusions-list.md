---
title: "On DataFusion's list, and one bug sent back"
date: "2026-11-17"
description: "nuthatch is now one of Apache DataFusion's known users, a one-line docs change merged on 16 November. The more useful thing we gave back is a wrong-answer bug in DataFusion's top-k filter, found while making our own queries faster. Here is the bug, how Burrmill guards against it until the fix ships, and what we have not sent upstream yet."
author: "cargopete"
tags: ["nuthatch", "burrmill", "datafusion", "sql", "rust", "correctness"]
draft: false
---

On 16 November at 16:47 UTC, Andrew Lamb merged
[apache/datafusion#26025](https://github.com/apache/datafusion/pull/26025), which adds nuthatch to
the Known Users list in DataFusion's documentation. It is one line, in alphabetical order, and it
sat in the queue for six weeks, which is about right for a line of documentation in a project that
size. **We mention it because it is true rather than because it is large:** every SQL answer
nuthatch serves has been computed by DataFusion since 4.1.0, through
[Burrmill](https://github.com/nuthatch-org/burrmill), and the listing simply says so in their docs as
well as ours.

We opened that PR on 4 October, an hour before filing something more useful, so this post is mostly about that.

## How we came to be on the list at all

Until October, nuthatch's SQL ran on DuckDB. We wrote [Keeping DuckDB](/blog/keeping-duckdb) on
31 August, reversed ourselves in [Replacing DuckDB, after all](/blog/replacing-duckdb-after-all) on
26 September, and finished the move in [One engine](/blog/one-engine) on 2 October. Burrmill is the
layer we built on DataFusion to make that possible: DuckDB's dialect, exact integer arithmetic,
plan shapes for the range joins indexers lean on, and a lockdown so a query cannot read the host's
files. nuthatch 5.21.0 links DataFusion 55.2.0.

That is the whole relationship. We do not maintain anything upstream and we are not committers. We
are a user with an unusually low tolerance for a wrong answer, because a wrong total over token
amounts does not look wrong. It looks like a number.

## The bug we were not looking for

On 3 October we made a query faster. DataFusion can take the running threshold of an
`ORDER BY ... LIMIT` (its top-k) and push it into the Parquet scan as a dynamic filter, so row
groups that cannot make the top k are never read. Burrmill wraps scans for cancellation, and the
wrapper had been stopping that filter from reaching them. We let it through, and in the same
evening found one shape of query that now came back wrong.

The reduction, filed the next day as
[apache/datafusion#26029](https://github.com/apache/datafusion/issues/26029), is a single table of
32,000 integers and this query:

```sql
WITH s AS (SELECT b, 31999 - b AS p, 31999 - b AS q FROM t)
SELECT p FROM s ORDER BY CASE WHEN b % 2 = 0 THEN p ELSE q END, b LIMIT 3;
```

The right answer is 0, 1, 2. With one partition and filter pushdown on, DataFusion 55.0.0 answers
15998, 15999, 16000, every time, with no error.

**The cause is the order in which the filter's columns are renamed.** To use the sort's threshold at
the scan, DataFusion rewrites each sort key into the scan's column numbering, matching the keys by
equality from the bottom of the expression up. The second key, `b`, sits inside the first. It is
renamed first, after which the first key no longer equals itself and is never renamed at all, so
its `p` keeps the sort's column number. At the scan that number belongs to `b`. The filter then
compares the wrong column with the threshold and skips the row groups that hold the answer.

With `b` as a `UInt64` the same fault fails loudly instead, comparing an integer with a decimal,
which is the more polite of the two outcomes.

## What Burrmill does until the fix ships

Burrmill carries an optimizer rule, `TopKFilters`, that looks for a sort whose keys contain one
another and gives that sort a filter of its own that the scan never sees. The scan reads everything
for that one shape of query, as it did before 3 October, and every other top-k keeps the speed-up.
It is a guard rather than a fix, and it comes out when DataFusion's own fix arrives.

That fix is close. A first attempt, #26031, was closed in favour of the approach the issue
suggested: rename from the top down and stop at the first match, so an outer key is matched before
anything inside it. [apache/datafusion#27118](https://github.com/apache/datafusion/pull/27118),
by a contributor who took the issue on 4 November, does that. Two reviewers, Andrew Lamb among
them, approved it on 16 November, the same day as the docs line. **As of 17 November it is not yet
merged**, so the guard stays.

## What this does not show

One bug in six weeks of production is not a measure of DataFusion's correctness, and we would not
offer it as one. We found it because we test every query against a reference and because we were
changing the exact code path it lives on. Most of DataFusion we rely on without having looked
inside, as everyone does.

Nor have we sent back everything we hold. Burrmill's repository keeps drafts of upstream reports in
`docs/upstream/`, and one more DataFusion report sits there, drafted on 28 September and not yet
reduced to a plan without Burrmill's own rule in it. An unreduced report costs a maintainer more
than it gives them, so it waits until it is small.

## Further reading

- [apache/datafusion#26029](https://github.com/apache/datafusion/issues/26029), the issue, with the
  `EXPLAIN ANALYZE` that shows the wrong column reaching the scan
- [One engine](/blog/one-engine), on what the move to Burrmill cost and found
- [Burrmill](https://github.com/nuthatch-org/burrmill), where `TopKFilters` lives in
  `crates/burrmill/src/df/topkfilter.rs`
