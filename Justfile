run:
  deno run --allow-read --allow-write main.ts

wasm wat_file="build/out.wat" wasm_file="build/out.wasm":
  mkdir -p build
  wat2wasm {{wat_file}} -o {{wasm_file}}

test:
  deno run --allow-read --allow-write --allow-run test.ts main.ts build/out.wat build/out.wasm
