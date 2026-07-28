import { assert_equals } from "../assert.ts";
import { lower_baba_type_declaration } from "./baba_declaration_lower.ts";
import { lower_baba_source } from "./baba_lower.ts";
import type { BabaCstNode } from "./baba_parser.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { parse_source } from "./parser.ts";

Deno.test("Baba lowers type declarations without the handwritten parser", () => {
  for (
    const source of [
      "type Option = | #Some I32 | #None\n",
      "type Choice = | #One I32 :& I64 | #Two I32 :& I64\n",
      "type Narrow = #Value I32 :& I64\n",
      "type Result error value = | #Ok value | #Err error\n",
      "type Pair = [I32, I64]\n",
      "type Row width = (I32; width)\n",
      "type Person = struct { .name = Text, .age = I32 }\n",
      "type Box value = struct { .value = value }\n",
      "type Id = newtype I32\n",
      "type Pair = newtype (I32, I64)\n",
      "type Pair = packed [I32, I64]\n",
      "type Node = | #Branch Node | #Leaf I32\n",
      "type Size = [I32; Size]\n",
      "type Size = (I32; Size)\n",
      "type Size = struct { .values = [I32; Size] }\n",
      "type Intish = I32 :| I64\n",
      'type Token = "Token"\n',
    ]
  ) {
    const lowered = lower_baba_source(parse_duck_source(source));
    assert_equals(diagnostics_of(lowered), []);
    assert_equals(checked_value(lowered), parse_source(source));
  }
});

Deno.test("Baba keeps declarations and runtime statements in source order indexes", () => {
  const source = "type Option = | #Some I32 | #None\n" +
    "let choice = #Some 42;\n" +
    "choice\n";
  const lowered = lower_baba_source(parse_duck_source(source));
  assert_equals(diagnostics_of(lowered), []);
  assert_equals(checked_value(lowered), parse_source(source));
});

Deno.test("bundled type declarations match the legacy declaration oracle", () => {
  let compared = 0;
  let attributed = 0;
  for (const path of duck_files("examples")) {
    const source = Deno.readTextFileSync(path);
    const parsed = parse_duck_source(source);
    for (
      const node of nodes_of_kind(
        parsed.cst.root,
        "type_declaration_statement",
      )
    ) {
      if (
        node.children.some((child) => child.kind === "attribute_group")
      ) {
        attributed += 1;
        assert_equals(
          diagnostics_of(lower_baba_type_declaration(node, source)).length,
          1,
        );
        continue;
      }
      const declaration_source = source.slice(node.start, node.end) + "\n";
      const declaration_node = nodes_of_kind(
        parse_duck_source(declaration_source).cst.root,
        "type_declaration_statement",
      )[0];
      if (declaration_node === undefined) {
        throw new Error("Expected isolated declaration from " + path);
      }
      const lowered = lower_baba_type_declaration(
        declaration_node,
        declaration_source,
      );
      assert_equals(diagnostics_of(lowered), []);
      assert_equals(
        checked_value(lowered),
        parse_source(declaration_source).declarations?.[0],
      );
      compared += 1;
    }
  }
  assert_equals(compared > 60, true);
  assert_equals(attributed, 2);
});

Deno.test("Baba rejects invalid type declaration names and duplicates", () => {
  for (
    const [source, expected] of [
      ["type I32 = I32\n", "conflicts with builtin type"],
      ["type Box Value = Value\n", "must use snake_case"],
      ["type Box value value = value\n", "Duplicate type parameter"],
      ["type Choice = | #One | #One\n", "Duplicate sum case"],
      ["type Choice = | #One I32\n", "Single-case sums omit the leading"],
      ["type Choice = #One | #Two\n", "Multiple-case sums require a leading"],
      [
        "type Pair = (I32, I64)\n",
        "Product types use `[...]`",
      ],
      ["type Empty = ()\n", "Product types use `[...]`"],
      [
        "type Function = (I32, I64) -> I32\n",
        "Product types use `[...]`",
      ],
      ["type Function = () -> I32\n", "Product types use `[...]`"],
      [
        "type Pair = struct { .value = I32, .value = I64 }\n",
        "Duplicate product member",
      ],
      ["type A = I32\ntype A = I64\n", "Duplicate declaration name"],
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    const messages = diagnostics.map((diagnostic) => diagnostic.message).join(
      "\n",
    );
    assert_equals(messages.includes(expected), true);
  }
});

Deno.test("Baba accumulates independent declaration member errors", () => {
  for (
    const source of [
      "type Box Value = 256u8\n",
      "type Pair = [256u8, 512u8]\n",
      "type Choice = | #First 256u8 | #Second 512u8\n",
      "type Shape = struct { .first = 256u8, .second = 512u8 }\n",
    ]
  ) {
    const diagnostics = diagnostics_of(
      lower_baba_source(parse_duck_source(source)),
    );
    assert_equals(
      diagnostics.length,
      2,
      "Expected two independent diagnostics for " + source,
    );
    const starts = diagnostics.map((diagnostic) => diagnostic.span.start);
    assert_equals(starts, [...starts].sort((left, right) => left - right));
  }
});

function nodes_of_kind(
  node: BabaCstNode | undefined,
  kind: string,
): BabaCstNode[] {
  if (node === undefined) return [];
  const nodes: BabaCstNode[] = [];
  if (node.kind === kind) nodes.push(node);
  for (const child of node.children) {
    nodes.push(...nodes_of_kind(child, kind));
  }
  return nodes;
}

function duck_files(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of Deno.readDirSync(directory)) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory) {
      paths.push(...duck_files(path));
    } else if (entry.isFile && path.endsWith(".duck")) {
      paths.push(path);
    }
  }
  return paths;
}
