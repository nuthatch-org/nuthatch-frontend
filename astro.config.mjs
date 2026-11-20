// @ts-check
import { defineConfig } from 'astro/config';

// Static output only. No islands, no adapters, no external scripts. Page views go to
// Vercel Web Analytics, same-origin and cookieless (see Layout.astro).
// The site's pitch is "nothing phones home" - the build practises it.
export default defineConfig({
  site: 'https://nuthatch-indexer.com',
  output: 'static',
  compressHTML: true,
  build: {
    // Inline all CSS into each page: zero extra stylesheet requests, and the
    // landing page stays a single small document. Fonts are the only sub-resources.
    inlineStylesheets: 'always',
  },
  // Astro sends no telemetry when ASTRO_TELEMETRY_DISABLED is set; we also
  // disable it in the build script environment. No client runtime is shipped.
  devToolbar: { enabled: false },
  markdown: {
    // Two themes, neither of them the default: Shiki then emits every token
    // colour as --shiki-light / --shiki-dark rather than a hard inline colour,
    // which is what global.css switches on. With a single theme the light
    // toggle left dark-theme token colours sitting on a near-white ground.
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    },
  },
});
