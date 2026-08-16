import { assert_equals } from "../assert.ts";
import { source_for_gpufuck } from "../frontend/gpufuck_pipeline.ts";
import { parse_source } from "../frontend/parser.ts";
import { core_from_source } from "./from_source.ts";

Deno.test("integer-to-float conversions do not taint later arithmetic", () => {
  const core = core_from_source(parse_source(`
let scale: I32 -> F32 = (value: I32) => do
  let converted: F32 = @f32_from_i32(value);
  converted / 2.0f32
end;
scale
`));
  const scale = core.recFunctions?.scale;

  if (scale === undefined || scale.body?.tag !== "block") {
    throw new Error("Missing lowered scale function");
  }

  const result = scale.body.statements[1];

  if (result === undefined || result.tag !== "expr") {
    throw new Error("Missing lowered scale result");
  }

  assert_equals(result.expr, {
    tag: "prim",
    prim: "f32.div",
    args: [
      { tag: "var", name: "converted" },
      { tag: "num", type: "f32", value: 2 },
    ],
    integer: undefined,
  });
});

Deno.test("runtime aggregate constructors retain their declared type name after extension", () => {
  const core = core_from_source({
    tag: "program",
    statements: [
      {
        tag: "bind",
        kind: "const",
        name: "Choice",
        is_linear: false,
        annotation: undefined,
        value: {
          tag: "union_type",
          cases: [
            { name: "Left", type_name: "I32" },
            { name: "Right", type_name: "Unit" },
          ],
        },
      },
      {
        tag: "bind",
        kind: "const",
        name: "Choice",
        is_linear: false,
        annotation: undefined,
        value: {
          tag: "struct_update",
          base: { tag: "var", name: "Choice" },
          fields: [{ name: "label", value: { tag: "text", value: "choice" } }],
        },
      },
      {
        tag: "bind",
        kind: "let",
        name: "choice",
        is_linear: false,
        annotation: "Choice",
        value: {
          tag: "union_case",
          name: "Left",
          value: { tag: "num", type: "i32", value: 1 },
          type_expr: { tag: "var", name: "Choice" },
        },
      },
    ],
  });
  const choice = core.statements.find((statement) => {
    return statement.tag === "bind" && statement.name === "choice";
  });

  if (choice === undefined || choice.tag !== "bind") {
    throw new Error("Missing lowered choice binding");
  }

  assert_equals(choice.value, {
    tag: "union_case",
    name: "Left",
    value: { tag: "num", type: "i32", value: 1 },
    type_expr: { tag: "var", name: "Choice" },
  });
  assert_equals(
    core.statements.some((statement) => {
      return statement.tag === "bind" &&
        statement.name.startsWith("_Choice#shadow");
    }),
    false,
  );
});

Deno.test("nominal struct values retain their type through From extensions", () => {
  const core = core_from_source(
    source_for_gpufuck(
      parse_source(`
const { .struct } = import "duck:prelude/types" ();
const { .from } = import "duck:prelude/functional" ();

type Box = struct { .value = I32 }

extend Box {
  .from = box => box.value,
}

let box: Box = [.value = 42];
let converted: I32 = from box;
converted
`),
    ),
  );
  const box = core.statements.find((statement) => {
    return statement.tag === "bind" && statement.name === "box";
  });

  if (box === undefined || box.tag !== "bind") {
    throw new Error("Missing lowered Box binding");
  }

  assert_equals(box.value, {
    tag: "struct_value",
    type_expr: { tag: "var", name: "Box" },
    fields: [
      {
        name: "value",
        value: { tag: "num", type: "i32", value: 42 },
      },
    ],
  });
});

Deno.test("max dispatches through the Max duck", () => {
  const core = core_from_source(
    source_for_gpufuck(
      parse_source(`
const { .max } = import "duck:prelude/functional" ();

let selected: I32 = max (1, 2);
let floating: F32 = max (1f32, 2f32);
selected
`),
    ),
  );
  const selected = core.statements.find((statement) => {
    return statement.tag === "bind" && statement.name === "selected";
  });

  if (
    selected === undefined || selected.tag !== "bind" ||
    selected.value.tag !== "app" || selected.value.func.tag !== "var"
  ) {
    throw new Error("Missing lowered max call");
  }

  assert_equals(selected.value.func.name.startsWith("_duck_extension#"), true);
  assert_equals(selected.value.args, [
    { tag: "num", type: "i32", value: 1 },
    { tag: "num", type: "i32", value: 2 },
  ]);

  const floating = core.statements.find((statement) => {
    return statement.tag === "bind" && statement.name === "floating";
  });

  if (
    floating === undefined || floating.tag !== "bind" ||
    floating.value.tag !== "app" || floating.value.func.tag !== "var"
  ) {
    throw new Error("Missing lowered floating max call");
  }

  assert_equals(floating.value.func.name.startsWith("_duck_extension#"), true);
  assert_equals(floating.value.args, [
    { tag: "num", type: "f32", value: 1 },
    { tag: "num", type: "f32", value: 2 },
  ]);
});
