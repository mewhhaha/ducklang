run:
  deno run --allow-read --allow-write main.ts

wasm wat_file="build/out.wat" wasm_file="build/out.wasm":
  mkdir -p build
  wat2wasm {{wat_file}} -o {{wasm_file}}

fmt:
  deno fmt *.ts src

fmt-check:
  deno fmt --check *.ts src

lint:
  deno lint

test:
  deno test --no-check --allow-read --allow-write --allow-run

examples:
  deno test --no-check --allow-read --allow-write --allow-run examples/examples.test.ts

check: fmt-check lint test
