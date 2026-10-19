#!/bin/sh
# Publish what's committed on main to https://orangezebra.cloud.
#
# Deploys a clean export of HEAD — never uncommitted edits in the working tree — and
# only after the tests pass. Run from anywhere in the repo:  sh worker/deploy.sh
set -eu

repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
branch=$(git -C "$repo" rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "On '$branch', not main — not deploying." >&2
  exit 1
fi
git -C "$repo" fetch -q origin main
if [ "$(git -C "$repo" rev-parse HEAD)" != "$(git -C "$repo" rev-parse origin/main)" ]; then
  echo "HEAD isn't the same as origin/main — push (or pull) first, so GitHub matches the site." >&2
  exit 1
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
git -C "$repo" archive HEAD | tar -x -C "$dir"

rev=$(git -C "$repo" rev-parse --short HEAD)
echo "Testing $rev…"
(cd "$dir" && node --test tests/*.test.mjs > "$dir/test.log" 2>&1) || {
  tail -30 "$dir/test.log" >&2
  echo "Tests failed — not deploying." >&2
  exit 1
}

# Every release gets its own offline cache, so phones always pick it up.
sed -i '' "s/^const CACHE_VERSION = \"[^\"]*\";/const CACHE_VERSION = \"purrfect-$rev\";/" "$dir/sw.js"
grep -q "purrfect-$rev" "$dir/sw.js" || { echo "Couldn't stamp the cache version — not deploying." >&2; exit 1; }

cd "$dir/worker"
npx --yes wrangler@4.125.0 deploy
