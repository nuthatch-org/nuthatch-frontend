---
title: "MCP server"
description: "The built-in MCP surface - schema discovery, SQL, entity lookup, and provenance."
order: 4
checked: 5.14.0 (2026-10-30)
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

## Tools

The eight generic tools below are advertised on every nest. The capability-gated ones are advertised
only where they will return data (RFC-0025): `balance`/`top_balances` where the nest has a
transfer-shaped decoder, and `flags`/`exposure` where compliance is configured.

- `status` - index status: contract, chain, rows indexed, holders, last and sealed block.
- `schema` - the data model: how tables and views are named and queried. Read this first.
- `tables` - every decoded table (`{alias}__{event}`) with columns, Solidity types, and topic0.
- `table` (`name`, `limit` = 50) - recent rows of one table, hot ∪ sealed.
- `sql` (`query`, `limit` = 200) - a read-only query over the live tip ∪ sealed history. SELECT/WITH
  only; returns a compact table plus a provenance stamp. The bridge passes a small row cap so an
  agent's context isn't flooded.
- `explain` (`query`) - validate a query **without executing it**; returns `{valid: true}` or an error
  with a fix hint. Cheaper than `sql` - check before you spend.
- `entity` (`id`) - one row by id (`{block:012}-{logindex:06}`).
- `diff` (`from` + `to`, or `block`, or `tx` with its `block`; `flow`, `top`, `final_only`) - what
  happened in that range as a JSON document of fixed sentences with exact amounts, the same bytes as
  `nuthatch diff --format json` and `GET /diff`. `flow: true` gives the token flow instead;
  `final_only` refuses a range above the sealed boundary, and `top` above 1,000 is refused. Since
  5.9.0.
- `balance` (`address`) / `top_balances` (`limit`) - derived balances from the IVM view (i128 base
  units as decimal strings).
- `flags` (`kind`) - threshold or velocity compliance flags (RFC-0008).
- `exposure` (`address`) - counterparty exposure to the labeled set, per label.

## Resources

Three read-only resources an MCP client can attach as context:

- `nuthatch://schema` (`text/plain`) - the composed schema document.
- `nuthatch://tables` (`application/json`) - the table list.
- `nuthatch://status` (`application/json`) - the index summary.

## Prompts

Three server-side prompts encode the known-good workflows. `investigate-address` is advertised only
where compliance is configured, like the tools it names:

- `profile-contract` - an activity overview of the indexed contract(s), starting from `schema`.
- `investigate-address` (`address`) - balances, exposure and flags for one address.
- `verify-a-number` (`claim`) - re-derive a figure from scratch, with provenance.

Everything is local: the server talks only to your own nest, and nothing phones home.
