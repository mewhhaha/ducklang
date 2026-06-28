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
  deno test --allow-read --allow-write --allow-run

check: fmt-check lint test
