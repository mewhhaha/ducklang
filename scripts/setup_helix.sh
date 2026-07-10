#!/usr/bin/env bash
set -euo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$repository/tree-sitter-ix"
tree-sitter generate

cd "$repository"
deno run --allow-read --allow-write --allow-env --allow-run=tree-sitter scripts/setup_helix.ts
hx --health ix
