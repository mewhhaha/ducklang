import { assert_equals } from "../assert.ts";
import type { BabaCstNode } from "./baba_parser.ts";
import { parse_duck_source } from "./baba_parser.ts";
import { lower_baba_type_reference } from "./baba_type_lower.ts";
import { checked_value, diagnostics_of } from "./checked.ts";
import { scan_source, source_tokens } from "./tokenize.ts";
import { format_type_expr, parse_type_expr } from "./type_expr.ts";
import { source_span } from "./syntax.ts";

Deno.test("Baba type lowering matches the legacy type-expression oracle", () => {
  for (
    const type_source of [
      "I32",
      "Never",
      "forall value. value -> value",
      "Box Element",
      "Text -> <Io.print> Unit",
      "Unit -> <Stdin :| Stdout> Unit",
      "I32 :| I64 :& U32 :- U8",
      "#build",
      "freeze Text",
      "&Text",
      "1",
      '"GET"',
      "'c'",
      "true",
      "()",
      "(I32, I64)",
      "[I32, I64]",
      "(I32; width)",
      "[Int; 2]",
      "[I32; 1 + 2 * 3]",
    ]
  ) {
    const source = "let value: " + type_source + " = 0;\n";
    const parsed = parse_duck_source(source);
    assert_equals(parsed.diagnostics, []);
    const type_node = find_node(parsed.cst.root, "type_reference");
    if (type_node === undefined) {
      throw new Error("Expected Baba type-reference node for " + type_source);
    }
    const lowered = lower_baba_type_reference(type_node, source);
    assert_equals(diagnostics_of(lowered), []);
    const type = checked_value(lowered);
    if (type === undefined) {
      throw new Error("Expected lowered Baba type for " + type_source);
    }
    const expected = parse_type_expr(
      source_tokens(scan_source(type_source)),
    );
    assert_equals(type, expected);
    assert_equals(format_type_expr(type), format_type_expr(expected));
  }
});

Deno.test("every bundled Baba type reference lowers directly", () => {
  let references = 0;
  for (const directory of ["examples"]) {
    for (const path of duck_files(directory)) {
      const source = Deno.readTextFileSync(path);
      const parsed = parse_duck_source(source);
      assert_equals(parsed.diagnostics, []);
      for (const node of nodes_of_kind(parsed.cst.root, "type_reference")) {
        references += 1;
        const lowered = lower_baba_type_reference(node, source);
        const diagnostics = diagnostics_of(lowered);
        if (diagnostics.length > 0) {
          throw new Error(
            path + " type at " + node.start.toString() + " failed: " +
              diagnostics.map((diagnostic) => diagnostic.message).join(", "),
          );
        }
        const type = checked_value(lowered);
        if (type === undefined) {
          throw new Error(path + " did not produce a Baba type.");
        }
        const type_source = source.slice(node.start, node.end);
        const legacy = parse_type_expr(
          source_tokens(scan_source(type_source)),
        );
        assert_equals(format_type_expr(type), format_type_expr(legacy));
      }
    }
  }
  assert_equals(references > 300, true);
});

Deno.test("Baba type lowering rejects invalid dependent type forms", () => {
  for (
    const [type_source, expected] of [
      ["forall Value. Value", "must use snake_case"],
      ["forall value value. value", "Duplicate type parameter"],
      ["[I32; _]", "does not support"],
      ["[I32; 0x10]", "does not support"],
      ["[I32; 1e2]", "does not support"],
      ["1.5f32", "Floating-point literals cannot be used as types"],
      ["256u8", "out of range for U8"],
    ]
  ) {
    const source = "let value: " + type_source + " = 0;\n";
    const parsed = parse_duck_source(source);
    const type_node = find_node(parsed.cst.root, "type_reference");
    if (type_node === undefined) {
      throw new Error("Expected Baba type-reference node for " + type_source);
    }
    const messages = diagnostics_of(
      lower_baba_type_reference(type_node, source),
    ).map((diagnostic) => diagnostic.message).join("\n");
    assert_equals(messages.includes(expected), true);
  }
});

Deno.test("Baba type lowering records exact product and effect origins", () => {
  const source = "let value: (I32, I64) -> <Stdin :| Stdout> Unit = 0;\n";
  const parsed = parse_duck_source(source);
  const type_node = find_node(parsed.cst.root, "type_reference");
  if (type_node === undefined) {
    throw new Error("Expected Baba type-reference node.");
  }
  const type = checked_value(lower_baba_type_reference(type_node, source));
  if (
    type === undefined || type.tag !== "arrow" ||
    type.param.tag !== "product" || type.effects?.tag !== "union"
  ) {
    throw new Error("Expected a product-to-effectful-arrow type.");
  }
  const first = type.param.entries[0];
  const second = type.param.entries[1];
  if (first === undefined || second === undefined) {
    throw new Error("Expected two product entries.");
  }
  assert_equals(source_span(first), { start: 12, end: 15 });
  assert_equals(source_span(second), { start: 17, end: 20 });
  assert_equals(source_span(type.effects), { start: 26, end: 41 });
  assert_equals(source_span(type.effects.left), { start: 26, end: 31 });
  assert_equals(source_span(type.effects.right), { start: 35, end: 41 });

  const array_source = "let value: [I32; 1 + 2 * width] = 0;\n";
  const array_node = find_node(
    parse_duck_source(array_source).cst.root,
    "type_reference",
  );
  if (array_node === undefined) {
    throw new Error("Expected Baba array type-reference node.");
  }
  const array_type = checked_value(
    lower_baba_type_reference(array_node, array_source),
  );
  if (
    array_type === undefined || array_type.tag !== "array" ||
    array_type.length.tag !== "binary" ||
    array_type.length.right.tag !== "binary"
  ) {
    throw new Error("Expected a composite Baba array length.");
  }
  const length_start = array_source.indexOf("1 +");
  const product_start = array_source.indexOf("2 *");
  const width_start = array_source.indexOf("width");
  assert_equals(source_span(array_type.length), {
    start: length_start,
    end: width_start + "width".length,
  });
  assert_equals(source_span(array_type.length.left), {
    start: length_start,
    end: length_start + 1,
  });
  assert_equals(source_span(array_type.length.right), {
    start: product_start,
    end: width_start + "width".length,
  });
  assert_equals(source_span(array_type.length.right.left), {
    start: product_start,
    end: product_start + 1,
  });
  assert_equals(source_span(array_type.length.right.right), {
    start: width_start,
    end: width_start + "width".length,
  });
});

Deno.test("Baba type lowering accumulates independent composite errors", () => {
  for (
    const type_source of [
      "256u8 -> 512u8",
      "256u8 :| 512u8",
      "(256u8, 512u8)",
      "forall Value. 256u8",
    ]
  ) {
    const source = "let value: " + type_source + " = 0;\n";
    const parsed = parse_duck_source(source);
    const type_node = find_node(parsed.cst.root, "type_reference");
    if (type_node === undefined) {
      throw new Error("Expected Baba type-reference node for " + type_source);
    }
    assert_equals(
      diagnostics_of(lower_baba_type_reference(type_node, source)).length,
      2,
      "Expected two independent diagnostics for " + type_source,
    );
  }
  const source = "let value: forall Value value. 256u8 = 0;\n";
  const type_node = find_node(
    parse_duck_source(source).cst.root,
    "type_reference",
  );
  if (type_node === undefined) {
    throw new Error("Expected Baba forall type-reference node.");
  }
  const starts = diagnostics_of(
    lower_baba_type_reference(type_node, source),
  ).map((diagnostic) => diagnostic.span.start);
  assert_equals(starts, [...starts].sort((left, right) => left - right));
});

function find_node(
  node: BabaCstNode | undefined,
  kind: string,
): BabaCstNode | undefined {
  if (node === undefined) return undefined;
  if (node.kind === kind) return node;
  for (const child of node.children) {
    const found = find_node(child, kind);
    if (found !== undefined) return found;
  }
  return undefined;
}

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
