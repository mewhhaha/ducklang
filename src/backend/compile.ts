import { DuckCompiler } from "./compiler.ts";

const input_path = Deno.args[0];

if (input_path === undefined || Deno.args.length > 2) {
  throw new Error(
    "usage: deno task compiler <input.duck> [output.wasm]",
  );
}

let output_path = Deno.args[1];

if (output_path === undefined) {
  if (input_path.endsWith(".duck")) {
    output_path = input_path.slice(0, -5) + ".wasm";
  } else {
    output_path = input_path + ".wasm";
  }
}

const compiler = await DuckCompiler.create();

try {
  const wasm = await compiler.compile_file(input_path);
  await Deno.writeFile(output_path, wasm);
  console.log(output_path);
} finally {
  compiler.destroy();
}
