run:
  deno run --allow-read --allow-write main.ts

wasm wat_file="build/out.wat" wasm_file="build/out.wasm":
  mkdir -p build
  wat2wasm {{wat_file}} -o {{wasm_file}}

fmt:
  deno fmt *.ts src .github/workflows/*.yaml

fmt-check:
  deno fmt --check *.ts src .github/workflows/*.yaml

lint:
  deno lint

test:
  deno test --allow-read --allow-write --allow-run

check: fmt-check lint test
