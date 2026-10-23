#!/usr/bin/env bash
# Find every place the site states a nuthatch version, and flag any that is not the current release.
#
#   ./scripts/version-check.sh            # checks against the latest GitHub release
#   ./scripts/version-check.sh 2.5.0      # checks against a version you name
#
# CI (.github/workflows/version-check.yml) always passes the version as $1, after a fetch
# that is itself allowed to fail the job. Do not add a skip path.
#
# Written after 2026-08-15, when a release pass took three attempts. The first missed `llms.txt`
# entirely (it still said v1.0.2 - four majors stale, in the file coding agents read). The second
# missed the **hero tag on the homepage**, the single most prominent version string on the site,
# because the sweep matched prose like "current release" and a bare `v2.2.0` in a `<span class="tag">`
# matched nothing.
#
# The lesson is not "look harder". It is that a version is a claim, and claims want a checker.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

WANT=${1:-}
if [ -z "$WANT" ]; then
  WANT=$(curl -fsS -m 20 https://api.github.com/repos/nuthatch-org/nuthatch/releases/latest 2>/dev/null \
         | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)
fi
[ -z "$WANT" ] && { echo "could not determine the current version; pass it as an argument"; exit 2; }
echo "current release: $WANT"
echo

# Any x.y.z that is not the wanted one, in files a reader or an agent actually sees.
# `blog/` is excluded on purpose: a post is dated writing and should keep the version it shipped with.
# `releases.json` is the changelog, every version by design; its newest entry is probed below.
stale=0
while IFS= read -r line; do
  f=${line%%:*}
  case "$f" in
    */blog/*|src/data/releases.json) continue ;;
  esac
  echo "  $line"
  stale=$((stale + 1))
done < <(grep -rnoE "v?[0-9]+\.[0-9]+\.[0-9]+" src public 2>/dev/null \
         | grep -vE ":v?${WANT//./\\.}$" \
         | grep -viE "glibc|node|tailwind|typescript|schema_version|rust|1\.95\.0" \
         | grep -vE "127\.0\.0|0\.0\.0|192\.168|10\.[0-9]+\.[0-9]+" )   # IPs, not versions

echo
if [ "$stale" -gt 0 ]; then
  echo "$stale version reference(s) not on $WANT - check each: some are legitimate history"
  echo "(a line like 'When cold data is damaged (2.2.0)' is a fact about a past release; leave it)"
else
  echo "no stale version references"
fi

echo
echo "current-release claims, checked at the exact line that carries each one:"
#
# **Why these probe a line and not a file.** Until 2026-09-02 each probe was `grep -q "$WANT" "$f"`:
# does this file mention the current version anywhere. That is not the claim. `index.astro` reported
# **OK** while its hero tag said `v3.0.0` and the release was `3.1.0`, because `$WANT` was used
# unescaped, so `3.1.0` is a regex whose dots match anything, and it matched `3-1.0` inside an SVG
# path coordinate on line 46. A check written *because* a release pass missed the hero tag was
# certifying that hero tag on the strength of vector geometry.
#
# Two faults, both fixed here: the version is matched literally with `grep -F`, and each probe reads
# the line that makes the claim rather than the file that contains it.
fail=0
probe() {  # probe <file> <what> <grep-args...>  - the matched line must carry $WANT literally
  local f=$1 what=$2; shift 2
  [ -f "$f" ] || return 0
  local line
  line=$(grep -m1 "$@" "$f" 2>/dev/null)
  if [ -z "$line" ]; then
    printf "  BROKEN  %-26s (%s)  <-- the probe matched nothing; the page changed shape\n" "$f" "$what"
    fail=1
  elif printf '%s' "$line" | grep -qF "$WANT"; then
    printf "  OK      %-26s (%s)\n" "$f" "$what"
  else
    printf "  STALE   %-26s (%s)\n" "$f" "$what"
    printf "          %s\n" "$(printf '%s' "$line" | cut -c1-96)"
    fail=1
  fi
}

probe src/pages/index.astro            "hero tag"                  -E 'class="tag"'
probe src/pages/install.astro           "install page description"  -E '^  description="Install Nuthatch'
# The /install release note and /changelog render from this; `node scripts/sync-releases.mjs` (#104).
probe src/data/releases.json            "latest in changelog"       -E '"version":'
probe src/pages/example.astro           "worked example"            -E 'current, executable path'
# A docs page stamps the release it was checked against in its frontmatter (`checked: 4.10.1`, #81).
# A page without the field makes no claim; one with it must name the current release.
for f in $(grep -rlE "^checked: " src/content/docs); do
  probe "$f" "page checked against" -E "^checked: "
done
probe src/layouts/BookLayout.astro      "book kicker"               -E 'class="book-kicker"'
probe src/content/docs/book/index.md    "book describes"            -E 'It describes Nuthatch'
probe public/llms.txt                   "what agents read"          -E '^MIT OR Apache-2.0\. Status:'
probe public/llms-full.txt              "what agents read"          -E 'Status: \*\*v'
# These six stayed on 4.0.2 through 4.3.1 with no probe to say so (2026-10-04).
probe src/pages/stories.astro           "stories kicker"            -E 'class="illus"'
probe src/pages/stories.astro           "stories preview note"      -E 'These workflows run on v'
probe src/pages/roadmap.astro           "roadmap current release"   -E 'is the current release</strong>'
probe src/pages/install.astro           "container tag"             -E 'ghcr.io/nuthatch-org/nuthatch:[0-9]'
probe src/content/docs/start/install.md "docs container tag"        -E 'ghcr.io/nuthatch-org/nuthatch:[0-9]'
probe src/content/docs/operate/deploy.md "deploy container tag"     -E 'ghcr.io/nuthatch-org/nuthatch:[0-9]'

echo
if [ "$fail" -ne 0 ]; then
  echo "FAIL: the site advertises a version that is not $WANT."
  echo
  echo "This is not cosmetic. A stale version on the hero tag or in llms.txt points readers and"
  echo "coding agents at a build we may have shipped a security fix past. Fix the lines above, then"
  echo "re-run. A BROKEN probe means the page was restructured and the probe needs re-pointing -"
  echo "treat that as a failure too, because a probe that matches nothing is the one that let"
  echo "v1.0.2 sit in llms.txt for four majors."
  exit 1
fi
echo "every checked claim states $WANT."
