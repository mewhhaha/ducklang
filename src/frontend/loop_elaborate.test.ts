import { assert_includes } from "../assert.ts";
import { format_source } from "./format.ts";
import {
  elaborate_front_loops,
  elaborate_front_ranges,
} from "./loop_elaborate.ts";
import { parse_source } from "./parser.ts";

Deno.test("loop elaboration makes recursive state explicit", () => {
  const source = parse_source(`
let total: I32 = 0;
for index in 0..3 {
  total = total + index
}
total
`);

  elaborate_front_ranges(source);
  elaborate_front_loops(source);
  const elaborated = format_source(source);

  assert_includes(
    elaborated,
    "type _duck_loop_output_type_0 = [I32, I32]",
  );
  assert_includes(elaborated, "let rec __duck_loop_0");
  assert_includes(elaborated, "_duck_loop_output_type_0");
});

Deno.test("collection loops share the recursive range representation", () => {
  const source = parse_source(`
let values = [20, 22];
let total = 0;
for value in values {
  total = total + value
}
total
`);

  elaborate_front_ranges(source);
  elaborate_front_loops(source);
  const elaborated = format_source(source);

  assert_includes(elaborated, "let __duck_collection_0 = values");
  assert_includes(elaborated, "let value: I32 = __duck_collection_0[");
  assert_includes(elaborated, "let rec __duck_loop_0");
});
