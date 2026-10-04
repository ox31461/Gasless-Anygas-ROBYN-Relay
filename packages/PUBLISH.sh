#!/bin/sh
# Manual fallback: publish the AnyGas npm packages from this checkout.
#
# The normal path is the tag-triggered workflow (.github/workflows/release.yml), which also
# publishes to JSR and PyPI, runs the tests first and adds npm provenance. See RELEASING.md.
# Use this only if CI is unavailable. Run `npm login` first (interactive).
#
#   packages/PUBLISH.sh                 # agent-kit + mcp (the default, as before)
#   packages/PUBLISH.sh agent-kit       # just one package
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "$#" -gt 0 ] || set -- agent-kit mcp

echo "npm user: $(npm whoami)"
published=""
for pkg in "$@"; do
  dir="$HERE/$pkg"
  [ -f "$dir/package.json" ] || { echo "no such package: $pkg ($dir)" >&2; exit 1; }
  name=$(cd "$dir" && node -p "require('./package.json').name")
  version=$(cd "$dir" && node -p "require('./package.json').version")
  (cd "$dir" && npm install --no-audit --no-fund && npm test && npm publish --access public)
  published="$published $name@$version"
done
echo "Published:$published"
