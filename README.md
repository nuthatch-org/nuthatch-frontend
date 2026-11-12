# nuthatch-frontend

The website for [Nuthatch](https://github.com/nuthatch-org/nuthatch) - a self-hosted-first,
AI-native blockchain indexer in one Rust binary.

Built with [Astro](https://astro.build), static output only. The site's pitch is "nothing
phones home", so the site practises it: no third-party requests, no external scripts, self-hosted
fonts. The one exception is Vercel Web Analytics: cookieless page views, served from this
origin. The other client-side JavaScript is copy-to-clipboard on code
blocks, the terminal typewriter and search, all of which degrade gracefully with JS disabled.

Search is a command palette on every page: Cmd+K, Ctrl+K, or `/` outside a text field. It reads
three static files from this origin and nothing else. `/palette.json` (every page, doc, heading,
post and nest by name) is fetched when the palette first opens; `/docs-search.json` and
`/blog-search.json` (the full text) when the reader first types. A page that is never searched
loads none of them.

## Structure

```
public/
  fonts/                 self-hosted, subset variable fonts (Space Grotesk, JetBrains Mono)
  favicon.svg            the nuthatch badge: a cream mark on a dark rounded tile, amber eye
  install.sh             fetches the release binary for your platform and verifies its checksum
  llms.txt               concise, agent-legible product summary
  llms-full.txt          full description for language models
  robots.txt             welcomes crawlers; points at the sitemap and llms files
  sitemap.xml            three URLs
src/
  layouts/Layout.astro   <head>, fonts, meta, skip link, nav + footer
  components/
    Nav.astro            sticky nav + CSS-only light/dark toggle (:has() checkbox hack)
    Footer.astro         links, licence, "no third-party resources" note
    Mark.astro           the logo badge, inline SVG (fixed brand colours)
    Palette.astro        the Cmd+K command palette: a native <dialog>, on every page
    CopyBlock.astro      copyable command block (copy button flips to "copied")
    CodeCard.astro       multi-line code block, build-time Shiki highlight + copy button
    Terminal.astro       faux-OS terminal, static transcript + typewriter enhancement
    Pipeline.astro       the data-path flow diagram (stacks on mobile)
  pages/
    index.astro          the landing page (all sections + real-example teaser)
    install.astro        expanded install instructions + verification
    example.astro        worked example: a Graph Horizon subgraph rebuilt as a nest
    manifesto.astro      the essay
    the-graph.astro      how Nuthatch and The Graph complement each other
  styles/global.css      design tokens (dark default + light) and shared styles
astro.config.mjs         static output, inlined CSS, compressed HTML
wrangler.toml            static-host config (Cloudflare Pages); production is Vercel
```

## Design

Follows the `minimalist-ui` taste skill (premium utilitarian minimalism: flat surfaces, 1px
borders, scarce pastel spot-accents, macro whitespace, editorial type), rendered dark-by-default
with a CSS-only light toggle. The light theme is the skill's exact warm-monochrome palette.
Type is Space Grotesk (variable, headings and body) and JetBrains Mono (code and terminal),
both self-hosted and subset to the glyphs actually used.

## Develop

```sh
npm install
npm run dev        # http://localhost:4321
```

## Build

```sh
npm run build      # outputs a self-contained dist/
npm run preview    # serve the built site locally
```

`dist/` is plain static files and works on any static host.

## Deploy - Vercel

Production is Vercel, and a deploy is one command from a linked checkout:

```sh
vercel --prod
```

That is the whole procedure: `nuthatch-frontend` under the `nbgn` team, promoted straight to
production. Check what is live with `vercel ls --prod`, and confirm against
https://nuthatch-indexer.com rather than the deployment URL.

**Merging is not publishing.** Nothing deploys this repo automatically, so a merged correction stays
invisible until someone runs the command above. To check whether that has happened:

```sh
npm run check:deployed          # compares https://nuthatch-indexer.com with this checkout
```

It fails if the published site was built from different source, if a page in the repo is missing
from the site, or if a page has stopped making a claim the repo makes. `npm run build` stamps
`dist/build-info.json` with a content hash of `src/`, which is what makes the first of those exact.
The same check runs in CI after every merge to `main` and once a day; it is not a pull-request gate,
because on a PR the deployed site is meant to be behind.

**Expect the first run to be red, and do not read that as a broken workflow.** The site currently
live was built before `dist/build-info.json` existed, so the fingerprint check reports that it can
establish nothing about the deployed build's age until a `vercel --prod` runs from a `npm run build`
that stamps it. That first stamped deploy clears it permanently. Until then the check is still doing
its job: as of 2026-08-23 it also names `/docs/operate/costs`, a page that merged and was never
published.

- Build command: `npm run build`
- Build output directory: `dist`
- Framework preset: Astro (or "None")

`dist/` is plain static files with no server, functions or runtime, so it also deploys unchanged to
Cloudflare Pages, Netlify, GitHub Pages, or a plain nginx box. `wrangler.toml` is kept for that
reason. It is **not** what production uses, and nothing in `package.json` or CI invokes wrangler.

## Performance budget

The landing page is intended to stay under **100 KB total transfer** (excluding any future
terminal recording) and score Lighthouse 100 across the board. The two woff2 fonts (~40 KB
combined) are the only sub-resources; CSS is inlined into each page; the interaction JS is a
few hundred bytes. Being tiny and instant is part of the pitch - keep it that way.

Fonts were subset from the full latin variable faces with `fonttools`:
Space Grotesk keeps its weight axis; JetBrains Mono is pinned to a single weight.

## TODO placeholders

These are intentional, marked in-source with `<!-- TODO -->` comments where practical:

| Placeholder | Where | Replace with |
|---|---|---|
| GitHub star badge | `src/pages/index.astro` (hero, `.stars`) | a live star count / badge post-launch |
| Measured benchmarks | proof cards say `target` | real measured RAM / time-to-first-query once available (the product repo already reports ~33 MB measured; the site keeps design-target framing until numbers are final) |
| Terminal recording | `src/components/Terminal.astro` + caption in `index.astro` | an asciinema recording of a real run, if preferred over the typewriter |
| GPG signing key | `src/pages/install.astro` (`.keybox-id`) | the real release signing key id + fingerprint at first tagged release |
| `install.sh` | `public/install.sh` | the real platform-detecting, checksum-verifying installer at first release |
| `docker-compose.yml` | referenced on `/install` | the real scaled-mode compose file |

## Licence

The Nuthatch project is AGPL-3.0. This site's content is part of that project.
