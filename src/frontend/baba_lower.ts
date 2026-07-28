import { Applicative } from "@mewhhaha/typeclasses";
import type { Prim } from "../op.ts";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import type { FrontExpr, Param, Source, Stmt } from "./ast.ts";
import type { BabaCstNode, BabaParseResult } from "./baba_parser.ts";
import { type Checked, fail, ok } from "./checked.ts";
import { parse_number_expr } from "./number_literal.ts";
import { mark_source_span, type SourceSpan } from "./syntax.ts";

export function lower_baba_source(parsed: BabaParseResult): Checked<Source> {
  const root = parsed.cst.root;
  if (root === undefined) {
    const source: Source = { tag: "program", statements: [] };
    mark_source_span(source, { start: 0, end: parsed.cst.text.length });
    return ok(source);
  }

  let statements: Checked<Stmt[]> = ok([]);
  const recovery_spans = parsed.diagnostics.map((diagnostic) =>
    diagnostic.span
  );
  for (const child of root.children) {
    const statement = lower_statement(
      child,
      parsed.cst.text,
      recovery_spans,
    );
    statements = Applicative.lift(
      (current: Stmt[], next: Stmt | undefined) => {
        if (next === undefined) return current;
        return [...current, next];
      },
      statements,
      statement,
    );
  }

  return statements.map((lowered) => {
    const source: Source = { tag: "program", statements: lowered };
    mark_source_span(source, { start: root.start, end: root.end });
    return source;
  });
}

function lower_statement(
  node: BabaCstNode,
  source: string,
  recovery_spans: readonly SourceSpan[],
): Checked<Stmt | undefined> {
  if (
    contains_recovery(node) ||
    recovery_spans.some((span) =>
      node.start <= span.start && node.end >= span.end
    )
  ) {
    return ok(undefined);
  }

  if (
    node.kind === "prefix_signature_statement" ||
    node.kind === "prefix_fact_statement"
  ) {
    return ok(undefined);
  }

  if (node.kind === "binding_statement") {
    return lower_binding(node, source);
  }

  if (node.kind === "expression_statement") {
    const expression_node = semantic_child(node);
    if (expression_node === undefined) {
      return unsupported(node);
    }
    return lower_expression(expression_node, source).map((expr) => {
      const statement: Stmt = { tag: "expr", expr };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    });
  }

  return unsupported(node);
}

function contains_recovery(node: BabaCstNode): boolean {
  if (node.kind === "ERROR" || node.kind === "MISSING") return true;
  return node.children.some(contains_recovery);
}

function lower_binding(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const value_nodes = node.children.filter((child) =>
    child !== name_node && is_expression_node(child)
  );
  const value_node = value_nodes[0];
  if (name_node === undefined || value_node === undefined) {
    return unsupported(node);
  }
  if (value_nodes.length !== 1) return unsupported(node);
  for (const child of node.children) {
    if (child === name_node || child === value_node) continue;
    if (
      child.kind === '"let"' ||
      child.kind === '"const"' ||
      child.kind === '"="' ||
      child.kind === '";"'
    ) {
      continue;
    }
    return unsupported(child);
  }

  let kind: "let" | "const" = "let";
  if (source.slice(node.start, node.start + 5) === "const") {
    kind = "const";
  }
  return lower_expression(value_node, source).map((value) => {
    const name = source.slice(name_node.start, name_node.end);
    const pattern = {
      tag: "binding" as const,
      name,
      mode: "default" as const,
      annotation: undefined,
    };
    mark_source_span(pattern, {
      start: name_node.start,
      end: name_node.end,
    });
    const statement: Stmt = {
      tag: "bind",
      kind,
      pattern,
      name,
      is_recursive: false,
      is_linear: false,
      annotation: undefined,
      value,
    };
    mark_source_span(statement, { start: node.start, end: node.end });
    return statement;
  });
}

function lower_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  if (
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product"
  ) {
    const child = semantic_child(node);
    if (child === undefined) return unsupported(node);
    return lower_expression(child, source);
  }

  if (node.kind === "identifier") {
    const expression: FrontExpr = {
      tag: "var",
      name: source.slice(node.start, node.end),
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "number") {
    try {
      const expression = parse_number_expr(source.slice(node.start, node.end));
      mark_source_span(expression, { start: node.start, end: node.end });
      return ok(expression);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      return fail(
        compiler_diagnostic(
          diagnostic_codes.syntax_error,
          message,
          { start: node.start, end: node.end },
        ),
      );
    }
  }

  if (node.kind === "boolean") {
    const expression: FrontExpr = {
      tag: "bool",
      value: source.slice(node.start, node.end) === "true",
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "string") {
    const raw = source.slice(node.start, node.end);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (_error) {
      return unsupported(node);
    }
    if (typeof value !== "string") return unsupported(node);
    const expression: FrontExpr = { tag: "text", value };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "unit_pattern") {
    const expression: FrontExpr = { tag: "unit" };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }

  if (node.kind === "binary_expression") {
    return lower_binary(node, source);
  }

  if (node.kind === "arrow_function") {
    return lower_arrow(node, source);
  }

  if (node.kind === "application_expression") {
    return lower_application(node, source);
  }

  if (node.kind === "positional_product") {
    const entries = node.children.filter((child) => is_expression_node(child))
      .map((child) =>
        lower_expression(child, source).map((value) => ({ value }))
      );
    let lowered_entries: Checked<{ value: FrontExpr }[]> = ok([]);
    for (const entry of entries) {
      lowered_entries = Applicative.lift(
        (
          current: { value: FrontExpr }[],
          next: { value: FrontExpr },
        ) => [...current, next],
        lowered_entries,
        entry,
      );
    }
    return lowered_entries.map((product_entries) => {
      const expression: FrontExpr = {
        tag: "product",
        entries: product_entries,
        value_pack: true,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    });
  }

  return unsupported(node);
}

function lower_binary(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const operands = node.children.filter((child) => is_expression_node(child));
  const operator_node = node.children.find((child) =>
    child.kind === "operator_symbol"
  );
  const left_node = operands[0];
  const right_node = operands[1];
  if (
    left_node === undefined || right_node === undefined ||
    operator_node === undefined
  ) {
    return unsupported(node);
  }
  const prim = binary_primitive(
    source.slice(operator_node.start, operator_node.end),
  );
  if (prim === undefined) return unsupported(operator_node);

  return Applicative.lift(
    (left: FrontExpr, right: FrontExpr) => {
      const expression: FrontExpr = { tag: "prim", prim, left, right };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(left_node, source),
    lower_expression(right_node, source),
  );
}

function lower_arrow(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const parameters: Param[] = [];
  const parameter_container = node.children.find((child) =>
    child.kind === "parameter" || child.kind === "parameter_list"
  );
  if (parameter_container === undefined) return unsupported(node);
  let parameter_nodes = [parameter_container];
  if (parameter_container.kind === "parameter_list") {
    parameter_nodes = parameter_container.children.filter((child) =>
      child.kind === "parameter"
    );
  }
  for (const parameter_node of parameter_nodes) {
    const name_node = parameter_node.children.find((child) =>
      child.kind === "identifier"
    );
    if (name_node === undefined) return unsupported(parameter_node);
    parameters.push({
      name: source.slice(name_node.start, name_node.end),
      is_const: false,
      is_linear: false,
      annotation: undefined,
    });
  }
  const body_node = [...node.children].reverse().find((child) =>
    is_expression_node(child)
  );
  if (body_node === undefined) return unsupported(node);

  return lower_expression(body_node, source).map((body) => {
    const expression: FrontExpr = {
      tag: "lam",
      params: parameters,
      body,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_application(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const expression_nodes = node.children.filter((child) =>
    is_expression_node(child)
  );
  const function_node = expression_nodes[0];
  const argument_node = expression_nodes[1];
  if (function_node === undefined || argument_node === undefined) {
    return unsupported(node);
  }
  return Applicative.lift(
    (func: FrontExpr, arg: FrontExpr) => {
      let args = [arg];
      if (arg.tag === "unit") args = [];
      if (arg.tag === "product" && arg.value_pack === true) {
        args = arg.entries.map((entry) => entry.value);
      }
      const expression: FrontExpr = {
        tag: "app",
        func,
        arg,
        args,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(function_node, source),
    lower_expression(argument_node, source),
  );
}

function semantic_child(node: BabaCstNode): BabaCstNode | undefined {
  return node.children.find((child) => is_expression_node(child));
}

function is_expression_node(node: BabaCstNode): boolean {
  return node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "identifier" ||
    node.kind === "number" ||
    node.kind === "boolean" ||
    node.kind === "string" ||
    node.kind === "unit_pattern" ||
    node.kind === "binary_expression" ||
    node.kind === "arrow_function" ||
    node.kind === "application_expression" ||
    node.kind === "positional_product";
}

function binary_primitive(operator: string): Prim | undefined {
  switch (operator) {
    case "+":
      return "i32.add";
    case "-":
      return "i32.sub";
    case "*":
      return "i32.mul";
    case "/":
      return "i32.div_s";
    case "%":
      return "i32.rem_s";
    case "==":
      return "i32.eq";
    case "!=":
      return "i32.ne";
    case "<":
      return "i32.lt_s";
    case "<=":
      return "i32.le_s";
    case ">":
      return "i32.gt_s";
    case ">=":
      return "i32.ge_s";
    default:
      return undefined;
  }
}

function unsupported(node: BabaCstNode): Checked<never> {
  return fail(
    compiler_diagnostic(
      diagnostic_codes.syntax_error,
      `Baba semantic lowering does not support ${node.kind}.`,
      { start: node.start, end: node.end },
    ),
  );
}
