import { Applicative } from "@mewhhaha/typeclasses";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import type {
  ArrayLengthExpr,
  EffectRowExpr,
  TypeExpr,
  TypeLiteral,
  TypeProductEntry,
} from "../type_syntax.ts";
import type { BabaCstNode } from "./baba_parser.ts";
import {
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
  ok,
} from "./checked.ts";
import { decode_literal_escape } from "./literal.ts";
import { is_snake_case } from "./names.ts";
import { parse_number_expr } from "./number_literal.ts";
import { mark_source_span, source_span } from "./syntax.ts";

export function lower_baba_type_reference(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  return lower_type(node, source);
}

function lower_type(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  if (
    node.kind === "type_reference" ||
    node.kind === "_type_expression" ||
    node.kind === "_type_application" ||
    node.kind === "_type_prefix" ||
    node.kind === "_type_atom"
  ) {
    const child = only_type_child(node);
    if (child === undefined) {
      if (
        direct_type_children(node).length === 2 &&
        type_set_operator(node, source) !== undefined
      ) {
        return lower_type_set_operation(node, source);
      }
      const text = source.slice(node.start, node.end);
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(text)) {
        if (text === "Never") {
          return ok(mark_type_span({ tag: "never" }, node));
        }
        return lower_named_type(text, node);
      }
      return unsupported_type(node);
    }
    return lower_type(child, source);
  }

  if (
    node.kind === "identifier" ||
    node.kind === "effect_identifier" ||
    node.kind === "lowercase_identifier"
  ) {
    const name = source.slice(node.start, node.end);
    if (name === "Never") {
      return ok(mark_type_span({ tag: "never" }, node));
    }
    return lower_named_type(name, node);
  }

  if (node.kind === "top_type" || node.kind === "wildcard") {
    return ok(mark_type_span({ tag: "top" }, node));
  }

  if (node.kind === "unit_type") {
    return ok(mark_type_span({
      tag: "product",
      entries: [],
      value_pack: true,
    }, node));
  }

  if (
    node.kind === "type_union" ||
    node.kind === "type_intersection" ||
    node.kind === "type_difference"
  ) {
    return lower_type_set_operation(node, source);
  }

  if (node.kind === "function_type") {
    return lower_function_type(node, source);
  }

  if (node.kind === "forall_type") {
    return lower_forall_type(node, source);
  }

  if (node.kind === "type_application") {
    const operands = direct_type_children(node);
    const func = operands[0];
    const arg = operands[1];
    if (func === undefined || arg === undefined || operands.length !== 2) {
      return unsupported_type(node);
    }
    const lowered_func = lower_type(func, source);
    const lowered_arg = lower_type(arg, source);
    return Applicative.lift(
      (func_value: TypeExpr, arg_value: TypeExpr) =>
        mark_type_span({
          tag: "apply",
          func: func_value,
          arg: arg_value,
        }, node),
      lowered_func,
      lowered_arg,
    );
  }

  if (node.kind === "atom_type") {
    const name = node.children.find((child) =>
      child.kind === "lowercase_identifier" || child.kind === "identifier"
    );
    if (name === undefined) return unsupported_type(node);
    return ok(mark_type_span({
      tag: "atom",
      name: source.slice(name.start, name.end),
    }, node));
  }

  if (node.kind === "frozen_type" || node.kind === "borrow_type") {
    let value_node: BabaCstNode | undefined = direct_type_children(node)[0];
    if (value_node === undefined) {
      value_node = node.children.find((child) =>
        child.kind === "identifier" || child.kind === "effect_identifier"
      );
    }
    if (value_node === undefined) return unsupported_type(node);
    const lowered = lower_type(value_node, source);
    const result = checked_value(lowered);
    if (result === undefined) return propagate_failure(lowered);
    let type: TypeExpr = { tag: "borrow", value: result };
    if (node.kind === "frozen_type") {
      type = { tag: "frozen", value: result };
    }
    return ok(mark_type_span(type, node));
  }

  if (node.kind === "type_parenthesized") {
    const value = only_type_child(node);
    if (value === undefined) return unsupported_type(node);
    return lower_type(value, source);
  }

  if (node.kind === "type_product") {
    const product = node.children.find((child) =>
      child.kind === "positional_type_product"
    );
    if (product === undefined) return unsupported_type(node);
    return lower_positional_type_product(product, source);
  }

  if (node.kind === "positional_type_product") {
    return lower_positional_type_product(node, source);
  }

  if (node.kind === "array_type") {
    return lower_array_type(node, source);
  }

  if (
    node.kind === "type_literal" ||
    node.kind === "number" ||
    node.kind === "string" ||
    node.kind === "character" ||
    node.kind === "boolean"
  ) {
    return lower_type_literal(node, source);
  }

  return unsupported_type(node);
}

function lower_named_type(
  name: string,
  node: BabaCstNode,
): Checked<TypeExpr> {
  const integer = /^[IU]([1-9][0-9]*)$/.exec(name);
  const width = integer?.[1];
  if (
    width !== undefined &&
    BigInt(width) > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        "Fixed-width integer width is too large: " + width,
        { start: node.start, end: node.end },
      ),
    );
  }
  return ok(mark_type_span({ tag: "name", name }, node));
}

function lower_type_set_operation(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  const operands = direct_type_children(node);
  const left = operands[0];
  if (left === undefined) return unsupported_type(node);
  if (operands.length === 1) return lower_type(left, source);
  const right = operands[1];
  if (right === undefined || operands.length !== 2) {
    return unsupported_type(node);
  }
  const lowered_left = lower_type(left, source);
  const lowered_right = lower_type(right, source);
  const operator = type_set_operator(node, source);
  if (operator === undefined) return unsupported_type(node);
  return Applicative.lift(
    (left_value: TypeExpr, right_value: TypeExpr) => {
      let type: TypeExpr = {
        tag: "union",
        left: left_value,
        right: right_value,
      };
      if (operator === ":&") {
        type = {
          tag: "intersection",
          left: left_value,
          right: right_value,
        };
      } else if (operator === ":-") {
        type = {
          tag: "difference",
          left: left_value,
          right: right_value,
        };
      }
      return mark_type_span(type, node);
    },
    lowered_left,
    lowered_right,
  );
}

function type_set_operator(
  node: BabaCstNode,
  source: string,
): ":|" | ":&" | ":-" | undefined {
  if (node.kind === "type_union") return ":|";
  if (node.kind === "type_intersection") return ":&";
  if (node.kind === "type_difference") return ":-";
  for (const child of node.children) {
    const operator = source.slice(child.start, child.end);
    if (operator === ":|" || operator === ":&" || operator === ":-") {
      return operator;
    }
  }
  return undefined;
}

function lower_function_type(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  const operands = direct_type_children(node);
  const parameter = operands[0];
  const result = operands[1];
  if (
    parameter === undefined || result === undefined || operands.length !== 2
  ) {
    return unsupported_type(node);
  }
  const lowered_parameter = lower_type(parameter, source);
  const lowered_result = lower_type(result, source);
  let lowered_effects: Checked<EffectRowExpr | undefined> = ok(undefined);
  const effects_node = node.children.find((child) =>
    child.kind === "latent_effect_row"
  );
  if (effects_node !== undefined) {
    lowered_effects = lower_effect_row(effects_node, source);
  }
  return Applicative.lift(
    (
      parameter_value: TypeExpr,
      effects: EffectRowExpr | undefined,
      result_value: TypeExpr,
    ) =>
      mark_type_span({
        tag: "arrow",
        param: parameter_value,
        effects,
        result: result_value,
      }, node),
    lowered_parameter,
    lowered_effects,
    lowered_result,
  );
}

function lower_forall_type(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  const param_nodes = node.children.filter((child) =>
    child.kind === "identifier"
  );
  const params = param_nodes.map((child) =>
    source.slice(child.start, child.end)
  );
  const body = direct_type_children(node).find((child) =>
    child.kind !== "identifier"
  );
  if (params.length === 0 || body === undefined) return unsupported_type(node);
  const seen = new Set<string>();
  const diagnostics = [];
  for (let index = 0; index < params.length; index += 1) {
    const param = params[index];
    const param_node = param_nodes[index];
    expect(
      param !== undefined && param_node !== undefined,
      "Baba forall parameter lost its source node.",
    );
    if (!is_snake_case(param)) {
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Type parameter must use snake_case: " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    if (seen.has(param)) {
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Duplicate type parameter: " + param,
          { start: param_node.start, end: param_node.end },
        ),
      );
    }
    seen.add(param);
  }
  const lowered_body = lower_type(body, source);
  let parameter_check: Checked<null> = ok(null);
  if (diagnostics.length > 0) parameter_check = fail(...diagnostics);
  return Applicative.lift(
    (_parameters: null, body_value: TypeExpr) =>
      mark_type_span({
        tag: "forall",
        params,
        body: body_value,
      }, node),
    parameter_check,
    lowered_body,
  );
}

function lower_positional_type_product(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  const element_nodes = node.children.filter((child) =>
    child.kind === "type_reference"
  );
  let lowered_entries: Checked<TypeProductEntry[]> = ok([]);
  for (const element_node of element_nodes) {
    const lowered = lower_type(element_node, source);
    lowered_entries = Applicative.lift(
      (entries: TypeProductEntry[], value: TypeExpr) => {
        const entry = { type_expr: value };
        mark_source_span(entry, {
          start: element_node.start,
          end: element_node.end,
        });
        return [...entries, entry];
      },
      lowered_entries,
      lowered,
    );
  }
  const semicolon = node.children.some((child) =>
    source.slice(child.start, child.end) === ";"
  );
  if (semicolon) {
    if (element_nodes.length !== 1) return unsupported_type(node);
    const length_node = node.children.find((child) =>
      child.kind !== "type_reference" &&
      is_array_length_node(child)
    );
    if (length_node === undefined) return unsupported_type(node);
    const repeat = lower_array_length(length_node, source);
    let lowered_repeat: Checked<ArrayLengthExpr> = fail(
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        `Baba type lowering does not support ${length_node.kind}.`,
        { start: length_node.start, end: length_node.end },
      ),
    );
    if (repeat !== undefined) lowered_repeat = ok(repeat);
    return Applicative.lift(
      (entries: TypeProductEntry[], value: ArrayLengthExpr) => {
        const type: Extract<TypeExpr, { tag: "product" }> = {
          tag: "product",
          entries,
          repeat: value,
        };
        if (source.slice(node.start, node.start + 1) === "(") {
          type.value_pack = true;
        }
        return mark_type_span(type, node);
      },
      lowered_entries,
      lowered_repeat,
    );
  }
  return lowered_entries.map((entries) => {
    const type: Extract<TypeExpr, { tag: "product" }> = {
      tag: "product",
      entries,
    };
    if (source.slice(node.start, node.start + 1) === "(") {
      type.value_pack = true;
    }
    return mark_type_span(type, node);
  });
}

function lower_array_type(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  const element_node = direct_type_children(node)[0];
  const length_node = node.children.find((child) =>
    child !== element_node && is_array_length_node(child)
  );
  if (element_node === undefined || length_node === undefined) {
    return unsupported_type(node);
  }
  const lowered_element = lower_type(element_node, source);
  const length = lower_array_length(length_node, source);
  let lowered_length: Checked<ArrayLengthExpr> = fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba type lowering does not support ${length_node.kind}.`,
      { start: length_node.start, end: length_node.end },
    ),
  );
  if (length !== undefined) lowered_length = ok(length);
  return Applicative.lift(
    (element: TypeExpr, value: ArrayLengthExpr) =>
      mark_type_span({
        tag: "array",
        element,
        length: value,
      }, node),
    lowered_element,
    lowered_length,
  );
}

function lower_array_length(
  node: BabaCstNode,
  source: string,
): ArrayLengthExpr | undefined {
  if (
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression"
  ) {
    const child = node.children.find((candidate) =>
      is_array_length_node(candidate)
    );
    if (child === undefined) return undefined;
    return lower_array_length(child, source);
  }
  if (node.kind === "number") {
    const text = source.slice(node.start, node.end);
    if (!/^[0-9]+$/.test(text)) return undefined;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    const length: ArrayLengthExpr = { tag: "number", value };
    mark_source_span(length, { start: node.start, end: node.end });
    return length;
  }
  if (node.kind === "identifier") {
    const length: ArrayLengthExpr = {
      tag: "name",
      name: source.slice(node.start, node.end),
    };
    mark_source_span(length, { start: node.start, end: node.end });
    return length;
  }
  if (node.kind !== "binary_expression") return undefined;
  const parts: ArrayLengthPart[] = [];
  if (!collect_array_length_parts(node, parts)) return undefined;
  const first = parts[0];
  if (first === undefined || first.tag !== "operand") return undefined;
  const first_value = lower_array_length(first.node, source);
  if (first_value === undefined) return undefined;
  const values = [first_value];
  const operators: ArrayLengthOperator[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const operator_part = parts[index];
    const operand_part = parts[index + 1];
    if (
      operator_part === undefined || operator_part.tag !== "operator" ||
      operand_part === undefined || operand_part.tag !== "operand"
    ) {
      return undefined;
    }
    const operator = source.slice(
      operator_part.node.start,
      operator_part.node.end,
    );
    const length_operator = array_length_operator(operator);
    if (length_operator === undefined) return undefined;
    const operand = lower_array_length(operand_part.node, source);
    if (operand === undefined) return undefined;
    while (true) {
      const pending = operators[operators.length - 1];
      if (
        pending === undefined ||
        pending.precedence < length_operator.precedence
      ) {
        break;
      }
      reduce_array_length(values, operators);
    }
    operators.push(length_operator);
    values.push(operand);
  }
  while (operators.length > 0) reduce_array_length(values, operators);
  const result = values[0];
  if (result === undefined || values.length !== 1) return undefined;
  return result;
}

type ArrayLengthPart =
  | { tag: "operand"; node: BabaCstNode }
  | { tag: "operator"; node: BabaCstNode };

type ArrayLengthOperator = {
  operator: "+" | "-" | "*" | "/" | "%";
  precedence: number;
};

function collect_array_length_parts(
  node: BabaCstNode,
  parts: ArrayLengthPart[],
): boolean {
  if (node.kind !== "binary_expression") {
    parts.push({ tag: "operand", node });
    return true;
  }
  const operands = node.children.filter((child) => is_array_length_node(child));
  const operator = node.children.find((child) =>
    child.kind === "operator_symbol"
  );
  const left = operands[0];
  const right = operands[1];
  if (left === undefined || right === undefined || operator === undefined) {
    return false;
  }
  if (!collect_array_length_parts(left, parts)) return false;
  parts.push({ tag: "operator", node: operator });
  return collect_array_length_parts(right, parts);
}

function array_length_operator(
  operator: string,
): ArrayLengthOperator | undefined {
  if (operator === "+" || operator === "-") {
    return { operator, precedence: 60 };
  }
  if (operator === "*" || operator === "/" || operator === "%") {
    return { operator, precedence: 70 };
  }
  return undefined;
}

function reduce_array_length(
  values: ArrayLengthExpr[],
  operators: ArrayLengthOperator[],
): void {
  const operator = operators.pop();
  const right = values.pop();
  const left = values.pop();
  expect(
    operator !== undefined && left !== undefined && right !== undefined,
    "Baba array-length reduction stack is incomplete.",
  );
  const length: ArrayLengthExpr = {
    tag: "binary",
    op: operator.operator,
    left,
    right,
  };
  mark_source_span(length, {
    start: source_span(left).start,
    end: source_span(right).end,
  });
  values.push(length);
}

function lower_type_literal(
  node: BabaCstNode,
  source: string,
): Checked<TypeExpr> {
  let literal_node = node;
  if (node.kind === "type_literal") {
    const child = node.children.find((candidate) =>
      candidate.kind === "number" || candidate.kind === "string" ||
      candidate.kind === "character" || candidate.kind === "boolean"
    );
    if (child === undefined) return unsupported_type(node);
    literal_node = child;
  }
  let literal: TypeLiteral;
  const text = source.slice(literal_node.start, literal_node.end);
  if (literal_node.kind === "number") {
    if (text.endsWith("f32") || text.endsWith("f64") || text.includes(".")) {
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          "Floating-point literals cannot be used as types: " + text,
          { start: literal_node.start, end: literal_node.end },
        ),
      );
    }
    let expression;
    try {
      expression = parse_number_expr(text);
    } catch (error) {
      let message = "Invalid numeric type literal: " + text;
      if (error instanceof Error) message = error.message;
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          message,
          { start: literal_node.start, end: literal_node.end },
        ),
      );
    }
    expect(expression.tag === "num", "Baba number did not lower to a number.");
    literal = {
      tag: "num",
      type: expression.type,
      value: expression.value,
    };
    if (expression.integer !== undefined) {
      literal.integer = expression.integer;
    }
  } else if (literal_node.kind === "string") {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (_error) {
      return unsupported_type(literal_node);
    }
    if (typeof value !== "string") return unsupported_type(literal_node);
    literal = { tag: "text", value };
  } else if (literal_node.kind === "character") {
    const character = decode_character(text);
    if (character === undefined) return unsupported_type(literal_node);
    const code_point = character.codePointAt(0);
    expect(code_point !== undefined, "Baba character has no code point.");
    literal = {
      tag: "num",
      type: "i32",
      value: code_point,
      character,
    };
  } else if (literal_node.kind === "boolean") {
    literal = { tag: "bool", value: text === "true" };
  } else {
    return unsupported_type(literal_node);
  }
  return ok(mark_type_span({ tag: "literal", value: literal }, node));
}

function decode_character(text: string): string | undefined {
  if (text.length < 3 || text[0] !== "'" || text[text.length - 1] !== "'") {
    return undefined;
  }
  const body = text.slice(1, text.length - 1);
  if (!body.startsWith("\\")) {
    if (Array.from(body).length !== 1) return undefined;
    return body;
  }
  if (body.length !== 2) return undefined;
  const escaped = body[1];
  if (escaped === undefined) return undefined;
  return decode_literal_escape(escaped, "'");
}

function lower_effect_row(
  node: BabaCstNode,
  source: string,
): Checked<EffectRowExpr> {
  if (
    node.kind === "latent_effect_row" ||
    node.kind === "effect_row" ||
    node.kind === "_effect_row_expression"
  ) {
    const child = node.children.find((candidate) =>
      is_effect_row_node(candidate)
    );
    if (child === undefined) return unsupported_effect(node);
    return lower_effect_row(child, source);
  }
  if (node.kind === "effect_family_reference") {
    const name = node.children.find((child) =>
      child.kind === "effect_identifier" || child.kind === "identifier"
    );
    if (name === undefined) return unsupported_effect(node);
    return ok(mark_effect_span({
      tag: "family",
      name: source.slice(name.start, name.end),
    }, node));
  }
  if (node.kind === "effect_operation_reference") {
    const names = node.children.filter((child) =>
      child.kind === "effect_identifier" || child.kind === "identifier"
    );
    const effect = names[0];
    const operation = names[1];
    if (effect === undefined || operation === undefined) {
      return unsupported_effect(node);
    }
    return ok(mark_effect_span({
      tag: "operation",
      effect: source.slice(effect.start, effect.end),
      operation: source.slice(operation.start, operation.end),
    }, node));
  }
  if (node.kind === "effect_row_variable") {
    const name = node.children.find((child) =>
      child.kind === "lowercase_identifier" ||
      child.kind === "underscore_identifier" || child.kind === "wildcard"
    );
    if (name === undefined) return unsupported_effect(node);
    return ok(mark_effect_span({
      tag: "variable",
      name: source.slice(name.start, name.end),
    }, node));
  }
  if (node.kind === "parenthesized_effect_expression") {
    const value_node = node.children.find((child) => is_effect_row_node(child));
    if (value_node === undefined) return unsupported_effect(node);
    const lowered = lower_effect_row(value_node, source);
    const value = checked_value(lowered);
    if (value === undefined) return propagate_failure(lowered);
    return ok(mark_effect_span({ tag: "group", value }, node));
  }
  if (
    node.kind === "effect_union_expression" ||
    node.kind === "effect_intersection_expression" ||
    node.kind === "effect_difference_expression"
  ) {
    const operands = node.children.filter((child) => is_effect_row_node(child));
    const left_node = operands[0];
    const right_node = operands[1];
    if (left_node === undefined || right_node === undefined) {
      return unsupported_effect(node);
    }
    const lowered_left = lower_effect_row(left_node, source);
    const lowered_right = lower_effect_row(right_node, source);
    return Applicative.lift(
      (left: EffectRowExpr, right: EffectRowExpr) => {
        let effect: EffectRowExpr = {
          tag: "union",
          left,
          right,
        };
        if (node.kind === "effect_intersection_expression") {
          effect = { tag: "intersection", left, right };
        } else if (node.kind === "effect_difference_expression") {
          effect = { tag: "difference", left, right };
        }
        return mark_effect_span(effect, node);
      },
      lowered_left,
      lowered_right,
    );
  }
  return unsupported_effect(node);
}

function only_type_child(node: BabaCstNode): BabaCstNode | undefined {
  const children = direct_type_children(node);
  if (children.length !== 1) return undefined;
  return children[0];
}

function direct_type_children(node: BabaCstNode): BabaCstNode[] {
  return node.children.filter((child) => is_type_node(child));
}

function is_type_node(node: BabaCstNode): boolean {
  return node.kind === "type_reference" ||
    node.kind === "_type_expression" ||
    node.kind === "_type_application" ||
    node.kind === "_type_prefix" ||
    node.kind === "_type_atom" ||
    node.kind === "forall_type" ||
    node.kind === "function_type" ||
    node.kind === "type_union" ||
    node.kind === "type_intersection" ||
    node.kind === "type_difference" ||
    node.kind === "type_application" ||
    node.kind === "atom_type" ||
    node.kind === "frozen_type" ||
    node.kind === "borrow_type" ||
    node.kind === "identifier" ||
    node.kind === "effect_identifier" ||
    node.kind === "lowercase_identifier" ||
    node.kind === "top_type" ||
    node.kind === "wildcard" ||
    node.kind === "type_literal" ||
    node.kind === "number" ||
    node.kind === "string" ||
    node.kind === "character" ||
    node.kind === "boolean" ||
    node.kind === "unit_type" ||
    node.kind === "type_parenthesized" ||
    node.kind === "type_product" ||
    node.kind === "positional_type_product" ||
    node.kind === "array_type";
}

function is_array_length_node(node: BabaCstNode): boolean {
  return node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "binary_expression" ||
    node.kind === "number" ||
    node.kind === "identifier" ||
    node.kind === "wildcard";
}

function is_effect_row_node(node: BabaCstNode): boolean {
  return node.kind === "_effect_row_expression" ||
    node.kind === "effect_row" ||
    node.kind === "effect_union_expression" ||
    node.kind === "effect_intersection_expression" ||
    node.kind === "effect_difference_expression" ||
    node.kind === "parenthesized_effect_expression" ||
    node.kind === "effect_family_reference" ||
    node.kind === "effect_operation_reference" ||
    node.kind === "effect_row_variable";
}

function mark_type_span<type extends TypeExpr>(
  value: type,
  node: BabaCstNode,
): type {
  mark_source_span(value, { start: node.start, end: node.end });
  return value;
}

function mark_effect_span<effect extends EffectRowExpr>(
  value: effect,
  node: BabaCstNode,
): effect {
  mark_source_span(value, { start: node.start, end: node.end });
  return value;
}

function propagate_failure<value, result>(
  check: Checked<value>,
): Checked<result> {
  const diagnostics = diagnostics_of(check);
  expect(
    diagnostics.length > 0,
    "Failed Baba lowering verdict has no diagnostic.",
  );
  return fail(...diagnostics);
}

function unsupported_type(node: BabaCstNode): Checked<never> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba type lowering does not support ${node.kind}.`,
      { start: node.start, end: node.end },
    ),
  );
}

function unsupported_effect(node: BabaCstNode): Checked<never> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba effect-row lowering does not support ${node.kind}.`,
      { start: node.start, end: node.end },
    ),
  );
}
