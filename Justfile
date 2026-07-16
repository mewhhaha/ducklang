run:
  deno run --allow-read --allow-write main.ts

duck *args:
  deno run --allow-read --allow-write duck.ts {{args}}

wasm wat_file="build/out.wat" wasm_file="build/out.wasm":
  mkdir -p build
  wat2wasm {{wat_file}} -o {{wasm_file}}

fmt:
  deno fmt *.ts src case-studies

fmt-check:
  deno fmt --check *.ts src case-studies

lint:
  deno lint --ignore=.claude

test:
  deno test --no-check --allow-read --allow-write --allow-run --ignore=.claude

examples:
  deno test --no-check --allow-read --allow-write --allow-run examples/examples.test.ts

helix-grammar:
  cd tree-sitter-duck && tree-sitter generate
  cd tree-sitter-duck && tree-sitter test
  cd tree-sitter-duck && rg --files ../examples -g '*.duck' -0 | xargs -0 tree-sitter parse --quiet --stat
  cd tree-sitter-duck && tree-sitter parse --quiet --stat ../src/frontend/prelude*.duck
  cd tree-sitter-duck && tree-sitter query queries/highlights.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && tree-sitter query queries/indents.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && tree-sitter query queries/textobjects.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && tree-sitter query queries/locals.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && tree-sitter query queries/tags.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null
  cd tree-sitter-duck && tree-sitter query queries/rainbows.scm ../examples/effects/01_inferred_io.duck ../examples/handlers/01_local_counter.duck >/dev/null

helix-register: helix-grammar
  scripts/setup_helix.sh

install: helix-register

check: fmt-check lint test
