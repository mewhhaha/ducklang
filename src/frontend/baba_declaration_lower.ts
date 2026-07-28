import { Applicative } from "@mewhhaha/typeclasses";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import type {
  ArrayLengthExpr,
  Declaration,
  FrontExpr,
  TypeDeclaration,
  TypeExpr,
  TypeField,
} from "./ast.ts";
import type { EffectRowExpr } from "../type_syntax.ts";
import type { BabaCstNode } from "./baba_parser.ts";
import { lower_baba_type_reference } from "./baba_type_lower.ts";
import {
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
  ok,
} from "./checked.ts";
import { is_snake_case } from "./names.ts";
import { is_builtin_type_reference_name } from "./parser_support.ts";
import { mark_source_span } from "./syntax.ts";
import { format_type_expr } from "./type_expr.ts";

type LoweredTypeDeclarationBody = {
  body: TypeDeclaration["body"];
  recursive: boolean;
};

export function lower_baba_type_declaration(
  node: BabaCstNode,
  source: string,
): Checked<Declaration> {
  const attribute = node.children.find((child) =>
    child.kind === "attribute_group"
  );
  if (attribute !== undefined) return unsupported_declaration(attribute);
  const names = node.children.filter((child) => child.kind === "identifier");
  const name_node = names[0];
  if (name_node === undefined) return unsupported_declaration(node);
  const name = source.slice(name_node.start, name_node.end);
  const param_nodes = names.slice(1);
  const params = param_nodes.map((parameter) =>
    source.slice(parameter.start, parameter.end)
  );
  const declaration_diagnostics = [];
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Type name must use PascalCase: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  if (is_builtin_type_reference_name(name)) {
    declaration_diagnostics.push(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Type declaration conflicts with builtin type: " + name,
        { start: name_node.start, end: name_node.end },
      ),
    );
  }
  const seen_params = new Set<string>();
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const param_node = param_nodes[index];
    expect(
      param !== undefined && param_node !== undefined,
      "Baba declaration parameter lost its source node.",
    );
    if (!is_snake_case(param)) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Type parameter must use snake_case: " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    if (seen_params.has(param)) {
      declaration_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate type parameter: " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    seen_params.add(param);
  }
  let declaration_check: Checked<null> = ok(null);
  if (declaration_diagnostics.length > 0) {
    declaration_check = fail(...declaration_diagnostics);
  }
  const definition = node.children.find((child) =>
    child.kind === "type_sum" || child.kind === "type_product" ||
    child.kind === "struct_type" || child.kind === "newtype_type" ||
    child.kind === "packed_type" || child.kind === "type_reference"
  );
  if (definition === undefined) return unsupported_declaration(node);

  let lowered_body: Checked<LoweredTypeDeclarationBody>;
  if (definition.kind === "type_sum") {
    lowered_body = lower_sum_body(definition, source, name);
  } else if (definition.kind === "struct_type") {
    lowered_body = lower_struct_body(definition, source, name);
  } else if (definition.kind === "packed_type") {
    lowered_body = lower_packed_body(definition, source, name);
  } else if (
    definition.kind === "type_product" &&
    source.slice(definition.start, definition.start + 1) === "["
  ) {
    lowered_body = lower_product_body(definition, source, "product", name);
  } else {
    lowered_body = lower_alias_body(definition, source, name);
  }

  return Applicative.lift(
    (_declaration: null, body: LoweredTypeDeclarationBody) => {
      const declaration: Declaration = {
        tag: "type",
        name,
        params,
        body: body.body,
        recursive: body.recursive,
      };
      mark_source_span(declaration, { start: node.start, end: node.end });
      return declaration;
    },
    declaration_check,
    lowered_body,
  );
}

function lower_sum_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  const names = new Set<string>();
  const case_nodes = node.children.filter((child) =>
    child.kind === "type_case"
  );
  if (case_nodes.length === 0) return unsupported_declaration(node);
  let sum_check: Checked<null> = ok(null);
  const has_leading_pipe = source.slice(node.start, node.end).trimStart()
    .startsWith("|");
  if (
    case_nodes.length === 1 &&
    has_leading_pipe
  ) {
    sum_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Single-case sums omit the leading `|`",
        { start: node.start, end: node.end },
      ),
    );
  } else if (case_nodes.length > 1 && !has_leading_pipe) {
    sum_check = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Multiple-case sums require a leading `|`",
        { start: node.start, end: node.end },
      ),
    );
  }
  let lowered_cases: Checked<
    { cases: TypeField[]; recursive: boolean }
  > = ok({ cases: [], recursive: false });
  for (const case_node of case_nodes) {
    const name_node = case_node.children.find((child) =>
      child.kind === "constructor_identifier"
    );
    if (name_node === undefined) return unsupported_declaration(case_node);
    const case_name = source.slice(name_node.start, name_node.end);
    const case_diagnostics = [];
    if (!/^[A-Z][A-Za-z0-9]*$/.test(case_name)) {
      case_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Sum case must use PascalCase: " + case_name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (names.has(case_name)) {
      case_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate sum case: " + case_name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    names.add(case_name);
    let case_check: Checked<null> = ok(null);
    if (case_diagnostics.length > 0) {
      case_check = fail(...case_diagnostics);
    }
    const payload_node = find_descendant(case_node, "type_reference");
    let lowered_payload: Checked<{ type_name: string; recursive: boolean }> =
      ok({ type_name: "Unit", recursive: false });
    if (payload_node !== undefined) {
      lowered_payload = lower_baba_type_reference(payload_node, source).map(
        (payload) => ({
          type_name: format_type_expr(payload),
          recursive: type_references_name(payload, declaration_name),
        }),
      );
    }
    const lowered_case = Applicative.lift(
      (
        payload: { type_name: string; recursive: boolean },
        _case: null,
      ) => {
        const field: TypeField = {
          name: case_name,
          type_name: payload.type_name,
        };
        mark_source_span(field, { start: case_node.start, end: case_node.end });
        return { field, recursive: payload.recursive };
      },
      lowered_payload,
      case_check,
    );
    lowered_cases = Applicative.lift(
      (
        current: { cases: TypeField[]; recursive: boolean },
        next: { field: TypeField; recursive: boolean },
      ) => ({
        cases: [...current.cases, next.field],
        recursive: current.recursive || next.recursive,
      }),
      lowered_cases,
      lowered_case,
    );
  }
  return Applicative.lift(
    (
      lowered: { cases: TypeField[]; recursive: boolean },
      _sum: null,
    ) => {
      const body: TypeDeclaration["body"] = {
        tag: "sum",
        cases: lowered.cases,
      };
      mark_source_span(body, { start: node.start, end: node.end });
      return { body, recursive: lowered.recursive };
    },
    lowered_cases,
    sum_check,
  );
}

function lower_struct_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  const lowered_entries = lower_named_fields(node, source);
  const entries = checked_value(lowered_entries);
  if (entries === undefined) return propagate_failure(lowered_entries);
  const fields = entries.map((entry) => entry.field);
  const shape: FrontExpr = {
    tag: "shape",
    entries: entries.map((entry) => {
      const value: FrontExpr = { tag: "set_type", type_expr: entry.type };
      return { label: entry.field.name, value };
    }),
  };
  const initializer: FrontExpr = {
    tag: "app",
    func: { tag: "var", name: "struct" },
    arg: shape,
    args: [shape],
  };
  const body: TypeDeclaration["body"] = {
    tag: "product",
    fields,
    positional: false,
    initializer,
  };
  mark_source_span(body, { start: node.start, end: node.end });
  return ok({
    body,
    recursive: entries.some((entry) =>
      type_references_name(entry.type, declaration_name)
    ),
  });
}

function lower_packed_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  const struct = node.children.find((child) => child.kind === "struct_type");
  if (struct !== undefined) {
    const lowered_entries = lower_named_fields(struct, source);
    const entries = checked_value(lowered_entries);
    if (entries === undefined) return propagate_failure(lowered_entries);
    const body: TypeDeclaration["body"] = {
      tag: "packed",
      fields: entries.map((entry) => entry.field),
      positional: false,
    };
    mark_source_span(body, { start: node.start, end: node.end });
    return ok({
      body,
      recursive: entries.some((entry) =>
        type_references_name(entry.type, declaration_name)
      ),
    });
  }
  const product = node.children.find((child) => child.kind === "type_product");
  if (product === undefined) return unsupported_declaration(node);
  return lower_product_body(product, source, "packed", declaration_name);
}

function lower_product_body(
  node: BabaCstNode,
  source: string,
  tag: "product" | "packed",
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  let product: BabaCstNode | undefined;
  if (node.kind === "positional_type_product") {
    product = node;
  } else {
    product = node.children.find((child) =>
      child.kind === "positional_type_product"
    );
  }
  if (product === undefined) return unsupported_declaration(node);
  let lowered_fields: Checked<
    { fields: TypeField[]; recursive: boolean }
  > = ok({ fields: [], recursive: false });
  for (
    const type_node of product.children.filter((child) =>
      child.kind === "type_reference"
    )
  ) {
    const lowered_type = lower_baba_type_reference(type_node, source);
    lowered_fields = Applicative.lift(
      (
        current: { fields: TypeField[]; recursive: boolean },
        type: TypeExpr,
      ) => {
        const field: TypeField = {
          name: "item_" + current.fields.length.toString(),
          type_name: format_type_expr(type),
        };
        mark_source_span(field, { start: type_node.start, end: type_node.end });
        return {
          fields: [...current.fields, field],
          recursive: current.recursive ||
            type_references_name(type, declaration_name),
        };
      },
      lowered_fields,
      lowered_type,
    );
  }
  return lowered_fields.map((lowered) => {
    const body: TypeDeclaration["body"] = {
      tag,
      fields: lowered.fields,
      positional: true,
    };
    mark_source_span(body, { start: node.start, end: node.end });
    return { body, recursive: lowered.recursive };
  });
}

function lower_alias_body(
  node: BabaCstNode,
  source: string,
  declaration_name: string,
): Checked<LoweredTypeDeclarationBody> {
  let type_node = node;
  let opaque = false;
  if (node.kind === "newtype_type") {
    opaque = true;
    const representation = find_descendant(node, "type_reference");
    if (representation === undefined) return unsupported_declaration(node);
    type_node = representation;
  }
  if (!opaque && starts_with_value_pack_type(node, source)) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Product types use `[...]`; parentheses only group types",
        { start: node.start, end: node.end },
      ),
    );
  }
  const lowered_type = lower_baba_type_reference(type_node, source);
  const type = checked_value(lowered_type);
  if (type === undefined) return propagate_failure(lowered_type);
  const body: Extract<TypeDeclaration["body"], { tag: "alias" }> = {
    tag: "alias",
    type_name: format_type_expr(type),
  };
  if (opaque) body.opaque = true;
  mark_source_span(body, { start: node.start, end: node.end });
  return ok({
    body,
    recursive: type_references_name(type, declaration_name),
  });
}

function starts_with_value_pack_type(
  node: BabaCstNode,
  source: string,
): boolean {
  if (source.slice(node.start, node.start + 1) !== "(") return false;
  if (node.kind === "unit_type") return true;
  if (node.kind === "type_product") {
    return find_descendant(node, '";"') === undefined;
  }
  const leading_child = node.children.find((child) =>
    child.start === node.start && is_type_syntax_node(child)
  );
  if (leading_child === undefined) return false;
  return starts_with_value_pack_type(leading_child, source);
}

function is_type_syntax_node(node: BabaCstNode): boolean {
  return node.kind === "type_reference" ||
    node.kind === "type_union" ||
    node.kind === "type_intersection" ||
    node.kind === "type_difference" ||
    node.kind === "function_type" ||
    node.kind === "type_application" ||
    node.kind === "type_parenthesized" ||
    node.kind === "type_product" ||
    node.kind === "positional_type_product" ||
    node.kind === "unit_type";
}

function lower_named_fields(
  node: BabaCstNode,
  source: string,
): Checked<Array<{ field: TypeField; type: TypeExpr }>> {
  let lowered_entries: Checked<Array<{ field: TypeField; type: TypeExpr }>> =
    ok([]);
  const names = new Set<string>();
  const field_nodes = descendants_of_kind(node, "named_type_field");
  if (field_nodes.length === 0) return unsupported_declaration(node);
  for (const field_node of field_nodes) {
    const name_node = field_node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    const type_node = find_descendant(field_node, "type_reference");
    if (name_node === undefined || type_node === undefined) {
      return unsupported_declaration(field_node);
    }
    const name = source.slice(name_node.start, name_node.end);
    const field_diagnostics = [];
    if (name !== "end" && !is_snake_case(name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "product member must use snake_case: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    if (names.has(name)) {
      field_diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate product member: " + name,
          { start: name_node.start, end: name_node.end },
        ),
      );
    }
    names.add(name);
    const lowered_type = lower_baba_type_reference(type_node, source);
    let field_check: Checked<null> = ok(null);
    if (field_diagnostics.length > 0) {
      field_check = fail(...field_diagnostics);
    }
    const lowered_entry = Applicative.lift(
      (type: TypeExpr, _field: null) => {
        const field: TypeField = {
          name,
          type_name: format_type_expr(type),
        };
        mark_source_span(field, {
          start: field_node.start,
          end: field_node.end,
        });
        return { field, type };
      },
      lowered_type,
      field_check,
    );
    lowered_entries = Applicative.lift(
      (
        entries: Array<{ field: TypeField; type: TypeExpr }>,
        entry: { field: TypeField; type: TypeExpr },
      ) => [...entries, entry],
      lowered_entries,
      lowered_entry,
    );
  }
  return lowered_entries;
}

function type_references_name(
  type_expr: TypeExpr,
  name: string,
): boolean {
  if (type_expr.tag === "name") return type_expr.name === name;
  if (
    type_expr.tag === "top" || type_expr.tag === "never" ||
    type_expr.tag === "atom" ||
    type_expr.tag === "literal"
  ) {
    return false;
  }
  if (type_expr.tag === "forall") {
    if (type_expr.params.includes(name)) return false;
    return type_references_name(type_expr.body, name);
  }
  if (type_expr.tag === "frozen" || type_expr.tag === "borrow") {
    return type_references_name(type_expr.value, name);
  }
  if (
    type_expr.tag === "union" || type_expr.tag === "intersection" ||
    type_expr.tag === "difference"
  ) {
    return type_references_name(type_expr.left, name) ||
      type_references_name(type_expr.right, name);
  }
  if (type_expr.tag === "apply") {
    return type_references_name(type_expr.func, name) ||
      type_references_name(type_expr.arg, name);
  }
  if (type_expr.tag === "tuple") {
    return type_expr.items.some((item) => type_references_name(item, name));
  }
  if (type_expr.tag === "product") {
    const entry_reference = type_expr.entries.some((entry) =>
      type_references_name(entry.type_expr, name)
    );
    return entry_reference ||
      array_length_references_name(type_expr.repeat, name);
  }
  if (type_expr.tag === "array") {
    return type_references_name(type_expr.element, name) ||
      array_length_references_name(type_expr.length, name);
  }
  if (type_expr.tag === "arrow") {
    return type_references_name(type_expr.param, name) ||
      effect_references_name(type_expr.effects, name) ||
      type_references_name(type_expr.result, name);
  }
  type_expr satisfies never;
  throw new Error("Unknown Baba declaration type.");
}

function array_length_references_name(
  length: ArrayLengthExpr | undefined,
  name: string,
): boolean {
  if (length === undefined || length.tag === "number") return false;
  if (length.tag === "name") return length.name === name;
  return array_length_references_name(length.left, name) ||
    array_length_references_name(length.right, name);
}

function effect_references_name(
  effect: EffectRowExpr | undefined,
  name: string,
): boolean {
  if (effect === undefined) return false;
  if (effect.tag === "family") return effect.name === name;
  if (effect.tag === "operation") return effect.effect === name;
  if (effect.tag === "variable") return effect.name === name;
  if (effect.tag === "group") {
    return effect_references_name(effect.value, name);
  }
  return effect_references_name(effect.left, name) ||
    effect_references_name(effect.right, name);
}

function find_descendant(
  node: BabaCstNode,
  kind: string,
): BabaCstNode | undefined {
  for (const child of node.children) {
    if (child.kind === kind) return child;
    const found = find_descendant(child, kind);
    if (found !== undefined) return found;
  }
  return undefined;
}

function descendants_of_kind(
  node: BabaCstNode,
  kind: string,
): BabaCstNode[] {
  const descendants: BabaCstNode[] = [];
  for (const child of node.children) {
    if (child.kind === kind) descendants.push(child);
    descendants.push(...descendants_of_kind(child, kind));
  }
  return descendants;
}

function propagate_failure<value, result>(
  check: Checked<value>,
): Checked<result> {
  const diagnostics = diagnostics_of(check);
  expect(
    diagnostics.length > 0,
    "Failed Baba declaration verdict has no diagnostic.",
  );
  return fail(...diagnostics);
}

function unsupported_declaration(node: BabaCstNode): Checked<never> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba declaration lowering does not support ${node.kind}.`,
      { start: node.start, end: node.end },
    ),
  );
}
