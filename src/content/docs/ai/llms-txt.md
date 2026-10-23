---
title: "llms.txt"
description: "The machine-readable index scaffolded projects ship for coding agents."
order: 2
checked: 5.11.0 (2026-10-23)
---

Every nest `init` scaffolds includes an `llms.txt` - a one-page, plain-text index of the project
written for coding agents. An agent that lands in the directory learns in one read what this thing is, what data it holds, and how to query it - without
crawling the source.

## What's in it

Generated from the decode registry - the same source of truth behind `schema.json`, `/tables`, and
the MCP `schema` tool - it contains:

- **What this is**: a self-hosted blockchain index on `<chain>`; query it locally, there is no
  third-party API.
- **The contracts**: every alias and address the nest indexes.
- **The tables**: one line per `{alias}__{event}` table with its columns.
- **The live HTTP API**: the handful of endpoints that matter (`/`, `/tables`,
  `/table/{name}`, `/entity/{id}`, `/sql?q=…`, `/balances`, `/balance/{address}`, `/queries`,
  `/derived`).
- **The MCP pointer**: run `nuthatch mcp` for the [tool surface](/docs/reference/mcp/), fully
  offline.

## Lifecycle

- **Generated, not authored.** `init` and `add` both write it; `nuthatch schema` regenerates it
  (with `schema.json` and the `semantic.toml` footguns) after you hand-edit the config. Don't
  maintain it by hand - it always reflects the tables the config actually produces.
- **Pinned in the bundle.** A nest's `llms.txt` is part of its content-addressed inputs, so a
  published nest carries its own agent documentation, verified by hash like everything else in
  [the registry](/docs/operate/registry/).

Alongside `llms.txt`, `init` also scaffolds a per-nest `.claude/skills/nuthatch` querying skill -
the deeper counterpart for agents that support skills. The distinction from
[the builder skill](/docs/ai/builder-skill/): the scaffolded skill teaches an agent to *query this
nest*; the builder skill teaches an agent to *drive nuthatch*.
