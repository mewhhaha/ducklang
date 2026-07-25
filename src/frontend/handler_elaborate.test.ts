import { assert_equals, assert_includes } from "../assert.ts";
import { format_source } from "./format.ts";
import { source_for_gpufuck } from "./gpufuck_pipeline.ts";
import { parse_source } from "./parser.ts";

const cursor_loop_program = `
const {} = import "duck:prelude" ();

type Ints = List I32
type IntNode = ListNode I32

effect Counter {
  add: (I32) => Unit
}

let run: Ints -> <Counter> Unit = (values: Ints) => {
  for value in values {
    _ <- Counter.add(value)
  }
  ()
};

let counter = {
  let sum = 0;
  handler Counter {
    add: (value, !resume) => {
      sum = sum + value
      !resume(())
    },
    return: _ => sum,
  }
};

let only: IntNode = [42, \`Nil ()];
let values: Ints = \`Cons only;

try run(values) with counter
`;

Deno.test("effects inside a cursor loop reach CPS elaboration", () => {
  const elaborated = format_source(
    source_for_gpufuck(parse_source(cursor_loop_program)),
  );

  // The union-cursor desugar emits its body as an `if_let` expression inside an
  // `expr` statement. The effect scan used to miss that shape, classify the
  // loop as pure, and fail with "Effect operation requires CPS elaboration".
  assert_includes(elaborated, "let rec __duck_effect_loop_0");
  assert_includes(elaborated, "if let `Cons @duck_payload#0 = @duck_cursor#0");
});

Deno.test("breaking out of an effectful loop does not re-enter it", () => {
  const elaborated = format_source(
    source_for_gpufuck(parse_source(cursor_loop_program)),
  );
  // Exactly two calls: the one that starts the loop and the tail call in the
  // arm that keeps iterating. The arm that breaks used to get a third, because
  // the `break` was threaded through the continuation that follows the loop.
  const calls = elaborated.split("__duck_effect_loop_0 [").length - 1;

  assert_equals(calls, 2);
});
