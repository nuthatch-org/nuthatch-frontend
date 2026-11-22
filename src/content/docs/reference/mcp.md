---
title: "MCP server"
description: "The built-in MCP surface - schema discovery, SQL, entity lookup, and provenance."
order: 4
checked: 5.24.0 (2026-11-22)
---

The protocol reference for the built-in Model Context Protocol server. For the experience - wiring
an agent up in one step and what it can do - see [AI-native → Agent-grade MCP](/docs/ai/mcp/).

## Transport

`nuthatch mcp` serves MCP over **stdio**, bridging to a running `nuthatch dev` HTTP API (`--url`,
default `http://127.0.0.1:8288`). The bridge is a thin client of the same guarded endpoints
described in the [HTTP API reference](/docs/reference/http-api/) - an agent gets no capability a
`curl` doesn't have. `nuthatch mcp --print-config` prints a copy-paste client config (a Claude Code
`.mcp.json` plus the `claude mcp add` one-liner) and exits. `--token-env <VAR>` (since 5.13.0) sends
the value of that environment variable as `Authorization: Bearer` on every request, for a nest behind
a gateway; without it, `NUTHATCH_MCP_TOKEN` is used when set. The token is never printed, and a
response that echoes it is redacted before the model sees it.

`--url` names one nest or one mount. Since 5.21.0, pointed at a runtime's root, which serves no
data, the bridge offers a single tool, `mounts`, naming the mounts to point it at, where every tool
used to answer a bare 404; a root with nothing mounted yet says so. A trailing slash on the URL no
longer breaks the routes.

## Tools

The nine generic tools below are advertised on every nest (eight before 5.22.0, which added `at`). The capability-gated ones are advertised
only where they will return data (RFC-0025): `balance`/`top_balances` where the nest has a
transfer-shaped decoder, `flags`/`exposure` where compliance is configured, and `queries`/`query`
where the mount declares named queries. Since 5.21.0 a mount that answers only declared queries
(`sql = "allowlist"` or `"deny"`) does not advertise `sql` or `explain`, which it would refuse.

- `status` - index status: contract, chain, rows indexed, holders, last and sealed block.
- `schema` - the data model: how tables and views are named and queried. Read this first.
- `tables` - every decoded table (`{alias}__{event}`) with columns, Solidity types, and topic0.
- `table` (`name`, `limit` = 50) - recent rows of one table, hot ∪ sealed.
- `sql` (`query`, `limit` = 200) - a read-only query over the live tip ∪ sealed history. SELECT/WITH
  only; returns a compact table plus a provenance stamp. The bridge passes a small row cap so an
  agent's context isn't flooded, and the node caps `limit` itself. Since 5.21.0 a line saying how
  many rows follow comes first, every table line begins with `| ` (chain data cannot start a line),
  and the whole answer is held to 256 KiB, with one notice saying what cut it. The provenance line
  names the source the node sent, and leads with a notice when the live tip could not be read.
  Since 5.22.0 it also takes `at_block` or `at_time` (unix seconds, UTC), and answers over the facts
  as they stood then, as `/sql` does; authored entities are not available as of a block.
- `at` (`time`) - since 5.22.0: where the nest stood at a time, in unix seconds UTC, as
  [`GET /at`](/docs/reference/http-api/#as-of-a-block-or-a-time) answers it: `block`, the newest block
  at or before it the nest holds a timestamp for, `next_block`, the oldest after it, `exact` and
  `final`. Refused for a time the nest has not indexed past.
- `explain` (`query`) - validate a query **without executing it**; returns `{valid: true}` or an error
  with a fix hint. Cheaper than `sql` - check before you spend.
- `entity` (`id`) - one row by id (`{block:012}-{logindex:06}`).
- `diff` (`from` + `to`, or `block`, or `tx` with its `block`; `flow`, `top`, `final_only`) - what
  happened in that range as a JSON document of fixed sentences with exact amounts, the same bytes as
  `nuthatch diff --format json` and `GET /diff`. `flow: true` gives the token flow instead;
  `final_only` refuses a range above the sealed boundary, and `top` above 1,000 is refused. Since
  5.9.0.
- `balance` (`address`) / `top_balances` (`limit`) - derived balances from the IVM view (i128 base
  units as decimal strings). Since 5.21.0 the result carries `complete_history`, and `indexed_from`
  where the nest records it. When `true`, the nest was indexed from its configured `start_block`
  with no `--backfill`, and the keys are `balance` and `holders`. When `false` or `null` (the nest
  does not record how its history began) the figures are only net flows since `indexed_from`, under
  `net_flow_since_indexed_from` and `net_receivers`, with a note. The HTTP `/balance` and
  `/balances` routes are unchanged.
- `flags` (`kind`) - threshold or velocity compliance flags (RFC-0008).
- `exposure` (`address`) - counterparty exposure to the labeled set, per label.
- `queries` / `query` (`name`, `params`) - since 5.21.0: the queries the mount declares, each with
  its parameters, and one of them run by name, returning the node's JSON with its provenance.

## Resources

Three read-only resources an MCP client can attach as context:

- `nuthatch://schema` (`text/plain`) - the composed schema document.
- `nuthatch://tables` (`application/json`) - the table list.
- `nuthatch://status` (`application/json`) - the index summary.

## Prompts

Three server-side prompts encode the known-good workflows. `investigate-address` is advertised only
where compliance is configured, like the tools it names; since 5.21.0 the two that tell the agent to
run SQL are not advertised on a mount that answers only declared queries:

- `profile-contract` - an activity overview of the indexed contract(s), starting from `schema`.
- `investigate-address` (`address`) - balances, exposure and flags for one address.
- `verify-a-number` (`claim`) - re-derive a figure from scratch, with provenance.

Everything is local: the server talks only to your own nest, and nothing phones home.
