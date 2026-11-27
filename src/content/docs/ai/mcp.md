---
title: "Agent-grade MCP"
description: "Drive nuthatch from an agent - fully offline against the local instance."
order: 1
checked: 5.24.1 (2026-11-26)
---

A nest isn't just queryable by you - it's queryable by your agent, with the same two-minute setup.
The MCP server is built into the binary, talks only to your local instance, and sends nothing
anywhere: no keys, no telemetry, no third-party data API in the loop.

## Wire it up in one step

With a nest running (`nuthatch dev`):

```sh
nuthatch mcp --print-config
```

This prints a ready-to-paste `.mcp.json` and the equivalent `claude mcp add` one-liner.
Any MCP client works the same way: the server speaks stdio and bridges to the running instance.
Then ask questions:

> "What were the ten largest transfers this week, and were any of the senders flagged?"

## Try it against a live nest, with nothing installed

Two nests run in public, read-only, with no key and no sign-up: Circle's USDC on Arc testnet and on Base.
Each speaks MCP over HTTP, so an agent can connect to one without a local nest or a binary:

```sh
claude mcp add --transport http arc-usdc https://nuthatch-indexer.com/nests/arc-usdc/mcp
claude mcp add --transport http base-usdc https://nuthatch-indexer.com/nests/base-usdc/mcp
```

Then ask: *"What were the five largest USDC transfers on Base in the last hour?"* They answer `SELECT` and
`WITH` only, with no admin routes, at most 30 queries a minute per address, and each query is cut off at
10 seconds and 5,000 rows. The Base nest holds the seven days before 19 November 2026 and everything since, not all of
Base's history; its `provenance` says what block a figure is current to. How they run is in
[docs/public-nests.md](https://github.com/nuthatch-org/nuthatch/blob/main/docs/public-nests.md).

## Per-client setup

Every client uses the same server entry - only where you put it differs. The entry is:

```json
{
  "mcpServers": {
    "nuthatch": { "command": "nuthatch", "args": ["mcp", "--url", "http://127.0.0.1:8288"] }
  }
}
```

- **Claude Code** - one line, no file editing: `claude mcp add nuthatch -- nuthatch mcp --url http://127.0.0.1:8288`. Or drop the entry into `.mcp.json` at your project root.
- **Cursor** - paste the entry into `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global).
- **Claude Desktop** - Settings -> Developer -> Edit Config opens `claude_desktop_config.json`; paste the entry there and restart.
- **Any other MCP client** - point it at the command `nuthatch mcp --url <your nest>`; the transport is plain stdio.

Use the binary's absolute path (what `nuthatch mcp --print-config` emits) if `nuthatch` isn't on the client's `PATH`.

## A nest behind a gateway

A nest you reach through a gateway that wants a bearer token takes one from an environment variable
(since 5.13.0), so the token never sits in `ps` or in the client's config:

```sh
export NEST_TOKEN=…        # or set NUTHATCH_MCP_TOKEN, which is read by default
claude mcp add nuthatch -- nuthatch mcp --url https://nest.example.com --token-env NEST_TOKEN
```

Every request then carries `Authorization: Bearer <token>`. `--print-config` prints the variable's
name, never its value, and an error body that echoes the token reaches the agent as `[redacted]`.

## An honest tool menu

The tools a nest advertises match what it actually indexes (RFC-0025). A token nest offers `balance`
and `top_balances`; a nest with compliance configured adds `flags` and `exposure`;
a bare event nest (say a Uniswap pool) offers neither, so an agent is never handed a tool that would
just answer `{"count":0}`. A mount that declares named queries adds `queries` and `query`, and since
5.21.0 a mount that answers only its declared queries no longer offers `sql`, `explain` or the
prompts that would send the agent to SQL. The menu agrees with the data.

Since 5.21.0 `balance` and `top_balances` also say what history they cover: `complete_history` is
`true` only for a nest indexed from its configured `start_block` with no `--backfill`. Otherwise
the figures are net flows since `indexed_from`, under `net_flow_since_indexed_from` and
`net_receivers`, not balances.

`--url` names one nest or one mount. Pointed at a runtime's root, which serves no data, the bridge
offers one tool since 5.21.0, `mounts`, naming the mounts to point it at.

## Built agent-grade, not agent-tolerant

The difference between an MCP that demos well and one an agent can *work* with is a set of
deliberate choices (RFC-0016):

- **Meaning travels with the schema.** The `schema` tool composes the decode registry with the
  authored [semantic layer](/docs/build/semantic/) - what each table *means*, its grain, and its
  footguns - so the agent doesn't guess what `value` is or rediscover that `from` needs quoting.
- **Errors are prompts.** A failed query returns a fix hint computed from the real schema: the
  nearest table name, the quoting rule, the `_dec` column to use. The agent's next attempt is
  usually right.
- **Check before you spend.** `explain` validates a query - binds every table, column, and type -
  without executing it, so an agent iterates on shape cheaply and runs `sql` once.
- **Results are shaped for context windows.** The bridge caps rows (default 200) and returns
  compact tables, not JSON walls. Since 5.21.0 a `sql` answer says first how many rows follow, and
  is held to 256 KiB with one notice saying what cut it.
- **Answers carry provenance.** A `sql` result ends with the block it is current to, the sealed
  watermark, the source the node sent and the registry hash (led by a notice when the live tip could
  not be read), so an agent can cite a figure, and `verify-a-number` (a built-in prompt)
  re-derives one from scratch. Since 5.22.0 `sql` takes `at_block` or `at_time`, and the `at` tool,
  on every nest, places a time against the nest's own blocks, so an agent can give a figure as it
  stood at a report date.

The tool-by-tool surface - plus the resources and the built-in prompts - is in the
[MCP reference](/docs/reference/mcp/). A CI-gated eval harness scores a fixed set of questions against
the query surface (RFC-0016), so regressions in the deterministic path fail like any other test; scoring
full agent sessions end-to-end is the harness's next tier.

For the authoring side - an agent *building* nests rather than querying one - see
[The builder skill](/docs/ai/builder-skill/).
