#!/bin/sh
# Nuthatch installer.
#
# Downloads the prebuilt binary for your platform from the latest GitHub release, verifies
# its SHA-256 checksum, and installs it. No compiler needed - you never build from source, so the
# rustc toolchain on your machine is irrelevant.
#
# It is deliberately short and readable. Piping a script to a shell asks for trust; read it first.
#   Source: https://github.com/nuthatch-org/nuthatch
#   Override install dir with NUTHATCH_INSTALL_DIR (default: $HOME/.local/bin).

set -eu

REPO="nuthatch-org/nuthatch"
BASE="https://github.com/${REPO}/releases/latest/download"

os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Darwin)
    case "$arch" in
      arm64 | aarch64) target="aarch64-apple-darwin" ;;
      x86_64) target="x86_64-apple-darwin" ;;
      *) echo "nuthatch: unsupported macOS architecture '$arch'" >&2; exit 1 ;;
    esac ;;
  Linux)
    case "$arch" in
      x86_64 | amd64) target="x86_64-unknown-linux-gnu" ;;
      aarch64 | arm64) target="aarch64-unknown-linux-gnu" ;;
      *) echo "nuthatch: no prebuilt binary for Linux '$arch' yet - build from source: cargo +1.95.0 install --git https://github.com/nuthatch-org/nuthatch nuthatch" >&2; exit 1 ;;
    esac ;;
  *)
    echo "nuthatch: unsupported OS '$os' - build from source: cargo +1.95.0 install --git https://github.com/nuthatch-org/nuthatch nuthatch" >&2; exit 1 ;;
esac

tarball="nuthatch-${target}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "nuthatch: downloading ${tarball}…"
# Releases up to 4.11.0 carry no aarch64 Linux tarball (#1961).
if ! curl -fsSL "${BASE}/${tarball}" -o "${tmp}/${tarball}"; then
  echo "nuthatch: the latest release has no ${tarball} - build from source: cargo +1.95.0 install --git https://github.com/nuthatch-org/nuthatch nuthatch" >&2; exit 1
fi
curl -fsSL "${BASE}/${tarball}.sha256" -o "${tmp}/${tarball}.sha256"

echo "nuthatch: verifying checksum…"
if command -v sha256sum >/dev/null 2>&1; then
  ( cd "$tmp" && sha256sum -c "${tarball}.sha256" >/dev/null )
elif command -v shasum >/dev/null 2>&1; then
  ( cd "$tmp" && shasum -a 256 -c "${tarball}.sha256" >/dev/null )
else
  echo "nuthatch: no sha256 tool found; refusing to install unverified" >&2; exit 1
fi

tar xzf "${tmp}/${tarball}" -C "$tmp"

dir="${NUTHATCH_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
install -m 0755 "${tmp}/nuthatch" "${dir}/nuthatch"

echo "nuthatch: installed to ${dir}/nuthatch"
case ":$PATH:" in
  *":$dir:"*) : ;;
  *)
    echo "nuthatch: ${dir} is not on your PATH. Add it:"
    echo ""
    if [ "$dir" = "$HOME/.local/bin" ]; then
      echo '  export PATH="$HOME/.local/bin:$PATH"'
    else
      echo "  export PATH=\"${dir}:\$PATH\""
    fi ;;
esac
echo ""
echo "  next:  nuthatch init 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 --alias weth"
echo "         nuthatch dev --backfill 300"
echo "         nuthatch sql \"SELECT count(*) FROM weth__transfer\""
