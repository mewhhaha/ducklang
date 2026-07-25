import { assert_includes } from "../assert.ts";
import { elaborate_front_effects } from "./effect_elaborate.ts";
import { format_source } from "./format.ts";
import { parse_source } from "./parser.ts";

const counter_program = `
effect Counter {
  get: () => I32
  add: (I32) => Unit
}

let run: () -> <Counter> I32 = () => {
  for value in 0..4 {
    if value % 2 == 0 {
      continue;
    }

    _ <- Counter.add(value)
  }

  total <- Counter.get()
  total
};

let counter = {
  let count = 0;
  handler Counter {
    get: (!resume) => !resume count,
    add: (amount, !resume) => {
      count = count + amount
      !resume(())
    },
    return: value => value,
  }
};

try run() with counter
`;

Deno.test("effectful range loops advance the index before the body", () => {
  const elaborated = format_source(
    elaborate_front_effects(parse_source(counter_program)),
  );

  // The user-visible index is captured first, then the driving index moves on,
  // and only then does the body run. That ordering is what lets `continue`
  // become a plain tail call.
  assert_includes(
    elaborated,
    "let value: I32 = __duck_effect_range_index_0; " +
      "__duck_effect_range_index_0 = __duck_effect_range_index_0 + " +
      "__duck_effect_range_step_0; if value % 2 == 0",
  );
});

Deno.test("continue in an effectful range loop becomes a recursive tail call", () => {
  const elaborated = format_source(
    elaborate_front_effects(parse_source(counter_program)),
  );

  assert_includes(
    elaborated,
    "if value % 2 == 0 __duck_effect_loop_0 " +
      "[__duck_effect_range_index_0, count] else",
  );
});
