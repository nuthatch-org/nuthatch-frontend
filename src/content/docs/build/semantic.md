---
title: The semantic layer
description: Describe what tables and columns mean, so agents query correctly instead of guessing.
order: 5
checked: 5.7.1
---

A schema tells you a column is named `value` and typed `uint256`. It doesn't tell you that `value` is
denominated in the token's smallest unit, that you have to divide by `10**decimals`, or that `from`
being the zero address means a mint. That knowledge - the **meaning** - is what separates a correct
query from a plausible-looking wrong one.

Nuthatch keeps that meaning in a **semantic layer**: a `semantic.toml` beside the nest, surfaced through
`/schema` and the [MCP server](/docs/ai/mcp/) so a coding agent gets the real story instead of guessing.

## What it captures

- **Table and column descriptions** - plain-English meaning, beyond the type.
- **Units and scaling** - "amounts are in wei; divide by `10**decimals`" - so an agent doesn't hand you
  a number 10¹⁸ too big.
- **Footguns** - the sharp edges: zero-address-means-mint, fee-on-transfer tokens, a `value` that's
  actually shares not assets. Every gotcha that produces a confidently wrong answer.
- **View and entity meanings** - what each [authored view](/docs/build/views/) or maintained
  [entity](/docs/build/entities/) computes and when to reach for it.

## Why it exists

The whole point of nuthatch's AI surface is that an agent querying your nest should get **real syntax and
real semantics**, not hallucinations. The semantic layer is how. It's the difference between an agent
that writes `SELECT SUM(value) FROM usdc__transfer` and gets a meaningless wei-sum, and one that knows to
scale by decimals and exclude mints.

> This is the same instinct as shipping `llms.txt` and a `.claude/skills/` directory in scaffolded
> projects (see [AI-native](/docs/ai/mcp/)): give the machine the truth up front, so it doesn't invent
> its own.

## Generated, then curated

`init` seeds `semantic.toml` from the ABI - placeholder descriptions per column plus the derived
footguns (reserved words, and the big-int columns that need `_dec`). You curate from there: add the
units, meanings, and domain knowledge only you have. If a description later references a column the
decode registry no longer has, `dev` warns at startup (``semantic.toml drift: semantic.toml describes
`weth__transfer.nosuch`, which isn't a column of that table``) - stale semantics are worse than none.

## Next

- [Authored SQL views](/docs/build/views/) - general query-time logic
- [Authored incremental entities](/docs/build/entities/) - bounded logic maintained while indexing
- [MCP server](/docs/ai/mcp/) - how agents consume the semantic layer
- [llms.txt](/docs/ai/llms-txt/) - the other half of the AI surface
