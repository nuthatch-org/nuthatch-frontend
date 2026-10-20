---
title: "The builder skill"
description: "The Claude Code skill that teaches an agent to drive nuthatch (RFC-0017)."
order: 3
checked: 5.8.1
---

The builder skill teaches a coding agent to *build with* nuthatch - scaffold nests, edit configs,
add factories and compliance, package and publish, run runtimes, and troubleshoot - the way an
experienced operator would. It lives in the repo at
[`skills/nuthatch-builder/`](https://github.com/nuthatch-org/nuthatch/tree/main/skills/nuthatch-builder)
and drops into any agent that reads Claude-style skills.

## The one rule: generate what can be generated

The way a skill lies is drift - it confidently describes a flag that changed two releases ago. So:

- **`cli-reference.md` is rendered from the binary itself** - clap's own metadata, via a hidden
  `skill-refs` subcommand. The binary describing itself is the most drift-proof source there is.
- **CI enforces it.** A test regenerates the reference and fails the build on any difference - and
  fails if any *authored* skill file mentions a `--flag` the generated reference doesn't contain.
  Hallucinated flags are the #1 way agents break a CLI, so the skill makes them structurally
  impossible to ship.
- Metric names get the same treatment: every `nuthatch_*` name the skill mentions is checked against
  the binary's own `/metrics` output in CI, so a stale metric name can't ship either.

## What the agent learns

The skill front-loads the **non-negotiables** the binary enforces (one writer; one cursor per
chain; sealed segments are immutable; the `/sql` guards are self-protection), the 90-second happy
path (`init` → `dev` → `sql`), and a routing map into focused references: the generated CLI
reference, the config reference, workflows (init→dev→sql, factories, bundle/publish, runtimes,
wiring an AI client), the views layer and its footguns, authored incremental entities, the
compliance pack, and symptom → metric → remedy troubleshooting.

The division of labour with [the MCP](/docs/ai/mcp/) is deliberate: the skill is **authoring
knowledge** (how to drive the CLI and shape a nest); the MCP is **runtime knowledge** (what's in
this nest's data as of block N). An agent building a nest uses the skill; an agent answering
questions uses the MCP; a good session uses both.

The parts that can rot are gated, not hoped: CI regenerates the CLI reference and fails on any drift,
and rejects any authored file that names a flag or metric the binary doesn't have. A full authoring
eval - scoring agent sessions end-to-end - is planned (RFC-0017).

A sibling skill,
[`skills/nuthatch-subgraph-port/`](https://github.com/nuthatch-org/nuthatch/tree/main/skills/nuthatch-subgraph-port)
(RFC-0044), ports a Graph subgraph to a nest, and writes a port report classifying every entity field
before anything is scaffolded.
