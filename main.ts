import { DuckCompiler } from "./src/compiler.ts";

const source = `
const make_adder = n => {
  x => x + n
}

const add_three = comptime make_adder(3)

let value = add_three(29)
value = value + 1
value
`;

const compiler = await DuckCompiler.create();

try {
  const execution = await compiler.run(source);
  console.log(Deno.inspect(execution.value, { colors: false }));
} finally {
  compiler.destroy();
}
