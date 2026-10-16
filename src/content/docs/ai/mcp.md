---
title: "Agent-grade MCP"
description: "Drive nuthatch from an agent - fully offline against the local instance."
order: 1
checked: 5.6.1
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

## An honest tool menu

The tools a nest advertises match what it actually indexes (RFC-0025). A token nest offers `balance`
and `top_balances`; a nest with compliance configured adds `flags` and `exposure`;
a bare event nest (say a Uniswap pool) offers neither, so an agent is never handed a tool that would
just answer `{"count":0}`. The menu agrees with the data.

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
  compact tables, not JSON walls.
- **Answers carry provenance.** A `sql` result ends with the block it is current to, the sealed
  watermark, the source and the registry hash, so an agent can cite a figure, and `verify-a-number` (a built-in prompt)
  re-derives one from scratch.

The tool-by-tool surface - plus the resources and the built-in prompts - is in the
[MCP reference](/docs/reference/mcp/). A CI-gated eval harness scores a fixed set of questions against
the query surface (RFC-0016), so regressions in the deterministic path fail like any other test; scoring
full agent sessions end-to-end is the harness's next tier.

For the authoring side - an agent *building* nests rather than querying one - see
[The builder skill](/docs/ai/builder-skill/).
