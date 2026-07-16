run:
  deno run --allow-read --allow-write main.ts

duck *args:
  deno run --allow-read --allow-write --allow-run=wat2wasm duck.ts {{args}}

wasm wat_file="build/out.wat" wasm_file="build/out.wasm":
  mkdir -p build
  wat2wasm {{wat_file}} -o {{wasm_file}}

fmt:
  deno fmt

fmt-check:
  deno fmt --check

lint:
  deno lint --ignore=.claude

typecheck:
  deno check main.ts duck.ts
  deno check scripts/*.ts
  rg --files src case-studies examples -g '*.test.ts' -0 | xargs -0 deno check

test:
  deno test --allow-read --allow-write --allow-run --ignore=.claude

examples:
  deno test --allow-read --allow-write --allow-run examples/examples.test.ts

grammar-check:
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter generate
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter test
  cd tree-sitter-duck && rg --files ../examples -g '*.duck' -0 | xargs -0 env XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter parse --quiet --stat
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter parse --quiet --stat ../src/frontend/prelude*.duck
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter query queries/highlights.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter query queries/indents.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter query queries/textobjects.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter query queries/locals.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter query queries/tags.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && XDG_CACHE_HOME=/tmp/ducklang-tree-sitter-cache tree-sitter query queries/rainbows.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  git diff --exit-code -- tree-sitter-duck/src/grammar.json tree-sitter-duck/src/node-types.json tree-sitter-duck/src/parser.c

helix-grammar: grammar-check

helix-register: helix-grammar
  scripts/setup_helix.sh

install: helix-register

check: fmt-check lint typecheck grammar-check test
