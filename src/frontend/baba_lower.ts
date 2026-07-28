import { Applicative } from "@mewhhaha/typeclasses";
import type { Prim } from "../op.ts";
import { compiler_diagnostic, diagnostic_codes } from "../diagnostic.ts";
import { expect } from "../expect.ts";
import type { FrontExpr, Param, Pattern, Source, Stmt } from "./ast.ts";
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

  const recovery_spans = parsed.diagnostics.map((diagnostic) =>
    diagnostic.span
  );
  const statements = lower_statement_sequence(
    root.children,
    parsed.cst.text,
    recovery_spans,
  );

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
    node.kind === "prefix_fact_statement" ||
    node.kind === "comment" ||
    node.kind === '";"'
  ) {
    return ok(undefined);
  }

  if (node.kind === "binding_statement") {
    return lower_binding(node, source);
  }

  if (node.kind === "assignment") {
    return lower_assignment(node, source);
  }

  if (node.kind === "return_statement") {
    return lower_return(node, source);
  }

  if (node.kind === "break_statement") {
    return lower_break(node, source);
  }

  if (node.kind === "continue_statement") {
    const statement: Stmt = { tag: "continue" };
    mark_source_span(statement, { start: node.start, end: node.end });
    return ok(statement);
  }

  if (node.kind === "expression_statement") {
    const expression_node = semantic_child(node);
    if (expression_node === undefined) {
      return unsupported(node);
    }
    if (
      expression_node.kind === "if_expression" &&
      !expression_node.children.some((child) =>
        child.kind === "else_clause" || child.kind === "else_if_clause"
      )
    ) {
      return lower_if_statement(expression_node, source);
    }
    return lower_expression(expression_node, source).map((expr) => {
      const statement: Stmt = { tag: "expr", expr };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    });
  }

  return unsupported(node);
}

function lower_statement_sequence(
  nodes: readonly BabaCstNode[],
  source: string,
  recovery_spans: readonly SourceSpan[],
): Checked<Stmt[]> {
  let statements: Checked<Stmt[]> = ok([]);
  for (const node of nodes) {
    statements = Applicative.lift(
      (current: Stmt[], next: Stmt | undefined) => {
        if (next === undefined) return current;
        return [...current, next];
      },
      statements,
      lower_statement(node, source, recovery_spans),
    );
  }
  return statements;
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

function lower_assignment(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const name_node = node.children.find((child) => child.kind === "identifier");
  const value_node = [...node.children].reverse().find((child) =>
    is_expression_node(child)
  );
  if (name_node === undefined || value_node === undefined) {
    return unsupported(node);
  }

  return lower_expression(value_node, source).map((value) => {
    let mode: "same" | "change" = "same";
    if (
      node.children.some((child) =>
        source.slice(child.start, child.end) === ":="
      )
    ) {
      mode = "change";
    }
    const statement: Stmt = {
      tag: "assign",
      name: source.slice(name_node.start, name_node.end),
      mode,
      value,
    };
    mark_source_span(statement, { start: node.start, end: node.end });
    return statement;
  });
}

function lower_return(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    const statement: Stmt = { tag: "return", value: { tag: "unit" } };
    mark_source_span(statement, { start: node.start, end: node.end });
    return ok(statement);
  }

  return lower_expression(value_node, source).map((value) => {
    const statement: Stmt = { tag: "return", value };
    mark_source_span(statement, { start: node.start, end: node.end });
    return statement;
  });
}

function lower_break(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    const statement: Stmt = { tag: "break" };
    mark_source_span(statement, { start: node.start, end: node.end });
    return ok(statement);
  }
  return lower_expression(value_node, source).map((value) => {
    const statement: Stmt = { tag: "break", value };
    mark_source_span(statement, { start: node.start, end: node.end });
    return statement;
  });
}

function lower_if_statement(
  node: BabaCstNode,
  source: string,
): Checked<Stmt> {
  const condition_node = node.children.find((child) =>
    child.kind === "condition_expression"
  );
  const branch_node = node.children.find((child) =>
    child.kind === "conditional_branch"
  );
  if (condition_node === undefined || branch_node === undefined) {
    return unsupported(node);
  }

  return Applicative.lift(
    (cond: FrontExpr, branch: FrontExpr) => {
      expect(
        branch.tag === "block",
        "Baba conditional branch did not lower to a block.",
      );
      const statement: Stmt = {
        tag: "if_stmt",
        cond,
        body: branch.statements,
      };
      mark_source_span(statement, { start: node.start, end: node.end });
      return statement;
    },
    lower_expression(condition_node, source),
    lower_conditional_branch(branch_node, source),
  );
}

function lower_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  if (
    node.kind === "postfix_expression" ||
    node.kind === "parenthesized_expression" ||
    node.kind === "parenthesized_or_product" ||
    node.kind === "condition_expression"
  ) {
    const child = semantic_child(node);
    if (child === undefined) return unsupported(node);
    return lower_expression(child, source);
  }

  if (node.kind === "identifier" || node.kind === "intrinsic_identifier") {
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

  if (
    node.kind === "binary_expression" ||
    node.kind === "condition_binary_expression"
  ) {
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

  if (node.kind === "block") {
    return lower_block(node, source);
  }

  if (node.kind === "if_expression") {
    return lower_if_expression(node, source);
  }

  if (node.kind === "condition_unary_expression") {
    return lower_condition_unary(node, source);
  }

  if (node.kind === "array_expression") {
    return lower_array_expression(node, source);
  }

  if (node.kind === "index_expression") {
    return lower_index_expression(node, source);
  }

  if (node.kind === "import_expression") {
    return lower_import_expression(node, source);
  }

  if (node.kind === "union_case") {
    return lower_union_case(node, source);
  }

  if (node.kind === "loop_expression") {
    return lower_loop_expression(node, source);
  }

  return unsupported(node);
}

function lower_block(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const statement_nodes = node.children.filter((child) =>
    child.kind !== '"do"' && child.kind !== '"end"'
  );
  return lower_statement_sequence(statement_nodes, source, []).map(
    (statements) => {
      const block_statements = [...statements];
      const final_statement = block_statements[block_statements.length - 1];
      if (
        final_statement !== undefined &&
        final_statement.tag === "if_stmt" &&
        final_statement.body[final_statement.body.length - 1]?.tag === "expr"
      ) {
        block_statements[block_statements.length - 1] = {
          tag: "expr",
          expr: {
            tag: "if",
            cond: final_statement.cond,
            then_branch: {
              tag: "block",
              statements: final_statement.body,
            },
            else_branch: { tag: "num", type: "i32", value: 0 },
            implicit_else: true,
          },
        };
      }
      const expression: FrontExpr = {
        tag: "block",
        statements: block_statements,
      };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
  );
}

function lower_if_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const condition_node = node.children.find((child) =>
    child.kind === "condition_expression"
  );
  const branch_node = node.children.find((child) =>
    child.kind === "conditional_branch"
  );
  if (condition_node === undefined || branch_node === undefined) {
    return unsupported(node);
  }

  const alternatives = node.children.filter((child) =>
    child.kind === "else_if_clause" || child.kind === "else_clause"
  );
  let else_branch: Checked<FrontExpr> = ok({
    tag: "num",
    type: "i32",
    value: 0,
  });
  let implicit_else = true;
  for (let index = alternatives.length - 1; index >= 0; index -= 1) {
    const alternative = alternatives[index];
    expect(alternative !== undefined, "Missing Baba conditional alternative.");
    if (alternative.kind === "else_clause") {
      const alternative_branch = alternative.children.find((child) =>
        child.kind === "conditional_branch"
      );
      if (alternative_branch === undefined) return unsupported(alternative);
      else_branch = lower_conditional_branch(alternative_branch, source);
      implicit_else = false;
      continue;
    }

    const alternative_condition = alternative.children.find((child) =>
      is_expression_node(child)
    );
    const alternative_branch = alternative.children.find((child) =>
      child.kind === "conditional_branch"
    );
    if (
      alternative_condition === undefined || alternative_branch === undefined
    ) {
      return unsupported(alternative);
    }
    else_branch = Applicative.lift(
      (
        cond: FrontExpr,
        then_branch: FrontExpr,
        nested_else: FrontExpr,
      ) => ({ tag: "if", cond, then_branch, else_branch: nested_else }),
      lower_expression(alternative_condition, source),
      lower_conditional_branch(alternative_branch, source),
      else_branch,
    );
  }

  return Applicative.lift(
    (
      cond: FrontExpr,
      then_branch: FrontExpr,
      lowered_else: FrontExpr,
    ) => {
      const expression: Extract<FrontExpr, { tag: "if" }> = {
        tag: "if",
        cond,
        then_branch,
        else_branch: lowered_else,
      };
      if (implicit_else) expression.implicit_else = true;
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(condition_node, source),
    lower_conditional_branch(branch_node, source),
    else_branch,
  );
}

function lower_condition_unary(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) return unsupported(node);
  return lower_expression(value_node, source).map((cond) => {
    const expression: FrontExpr = {
      tag: "if",
      cond,
      then_branch: { tag: "bool", value: false },
      else_branch: { tag: "bool", value: true },
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_array_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const entries = node.children.filter((child) => is_expression_node(child))
    .map((child) =>
      lower_expression(child, source).map((value) => ({ value }))
    );
  let lowered_entries: Checked<{ value: FrontExpr }[]> = ok([]);
  for (const entry of entries) {
    lowered_entries = Applicative.lift(
      (current: { value: FrontExpr }[], next: { value: FrontExpr }) => [
        ...current,
        next,
      ],
      lowered_entries,
      entry,
    );
  }
  return lowered_entries.map((product_entries) => {
    const expression: FrontExpr = {
      tag: "product",
      entries: product_entries,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_index_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const values = node.children.filter((child) => is_expression_node(child));
  const object_node = values[0];
  const index_node = values[1];
  if (object_node === undefined || index_node === undefined) {
    return unsupported(node);
  }
  return Applicative.lift(
    (object: FrontExpr, index: FrontExpr) => {
      const expression: FrontExpr = { tag: "index", object, index };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
    lower_expression(object_node, source),
    lower_expression(index_node, source),
  );
}

function lower_import_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const path_node = node.children.find((child) => child.kind === "string");
  if (path_node === undefined) return unsupported(node);
  const raw_path = source.slice(path_node.start, path_node.end);
  let path: unknown;
  try {
    path = JSON.parse(raw_path);
  } catch (_error) {
    return unsupported(path_node);
  }
  if (typeof path !== "string") return unsupported(path_node);
  const expression: FrontExpr = { tag: "import", path };
  mark_source_span(expression, { start: node.start, end: node.end });
  return ok(expression);
}

function lower_union_case(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const name_node = node.children.find((child) =>
    child.kind === "constructor_identifier"
  );
  if (name_node === undefined) return unsupported(node);
  const value_node = node.children.find((child) => is_expression_node(child));
  if (value_node === undefined) {
    const expression: FrontExpr = {
      tag: "union_case",
      name: source.slice(name_node.start, name_node.end),
      value: undefined,
      type_expr: undefined,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return ok(expression);
  }
  return lower_expression(value_node, source).map((value) => {
    const expression: FrontExpr = {
      tag: "union_case",
      name: source.slice(name_node.start, name_node.end),
      value,
      type_expr: undefined,
    };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_loop_expression(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const block_node = node.children.find((child) => child.kind === "block");
  if (block_node === undefined) return unsupported(node);
  return lower_block(block_node, source).map((block) => {
    expect(block.tag === "block", "Baba loop body did not lower to a block.");
    const expression: FrontExpr = { tag: "loop", body: block.statements };
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

function lower_conditional_branch(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  return lower_statement_sequence(node.children, source, []).map(
    (statements) => {
      const expression: FrontExpr = { tag: "block", statements };
      mark_source_span(expression, { start: node.start, end: node.end });
      return expression;
    },
  );
}

function lower_binary(
  node: BabaCstNode,
  source: string,
): Checked<FrontExpr> {
  const parts: BinaryPart[] = [];
  collect_binary_parts(node, parts);
  const first = parts[0];
  if (first === undefined || first.tag !== "operand") {
    return unsupported(node);
  }
  const values: Checked<FrontExpr>[] = [
    lower_expression(first.node, source),
  ];
  const operators: BinaryOperator[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const operator_part = parts[index];
    const operand_part = parts[index + 1];
    if (
      operator_part === undefined || operator_part.tag !== "operator" ||
      operand_part === undefined || operand_part.tag !== "operand"
    ) {
      return unsupported(node);
    }
    const operator = source.slice(
      operator_part.node.start,
      operator_part.node.end,
    );
    const precedence = binary_precedence(operator);
    if (precedence === undefined) return unsupported(operator_part.node);
    while (
      operators.length > 0 &&
      operators[operators.length - 1]?.precedence >= precedence
    ) {
      reduce_binary_operator(values, operators);
    }
    operators.push({ operator, precedence });
    values.push(lower_expression(operand_part.node, source));
  }
  while (operators.length > 0) reduce_binary_operator(values, operators);
  const result = values[0];
  expect(
    result !== undefined && values.length === 1,
    "Baba binary reduction did not produce one expression.",
  );
  return result.map((expression) => {
    mark_source_span(expression, { start: node.start, end: node.end });
    return expression;
  });
}

type BinaryPart =
  | { tag: "operand"; node: BabaCstNode }
  | { tag: "operator"; node: BabaCstNode };

type BinaryOperator = {
  operator: string;
  precedence: number;
};

function collect_binary_parts(
  node: BabaCstNode,
  parts: BinaryPart[],
): void {
  if (node.kind === "condition_expression") {
    const child = semantic_child(node);
    if (
      child !== undefined &&
      (child.kind === "binary_expression" ||
        child.kind === "condition_binary_expression")
    ) {
      collect_binary_parts(child, parts);
      return;
    }
  }
  if (
    node.kind !== "binary_expression" &&
    node.kind !== "condition_binary_expression"
  ) {
    parts.push({ tag: "operand", node });
    return;
  }
  const operands = node.children.filter((child) => is_expression_node(child));
  const operator = node.children.find((child) =>
    child.kind === "operator_symbol"
  );
  const left = operands[0];
  const right = operands[1];
  expect(
    left !== undefined && right !== undefined && operator !== undefined,
    "Baba binary CST is missing an operand or operator.",
  );
  collect_binary_parts(left, parts);
  parts.push({ tag: "operator", node: operator });
  collect_binary_parts(right, parts);
}

function reduce_binary_operator(
  values: Checked<FrontExpr>[],
  operators: BinaryOperator[],
): void {
  const operator = operators.pop();
  const right = values.pop();
  const left = values.pop();
  expect(
    operator !== undefined && left !== undefined && right !== undefined,
    "Baba binary reduction stack is incomplete.",
  );
  values.push(
    Applicative.lift(
      (left_value: FrontExpr, right_value: FrontExpr) =>
        binary_expression(operator.operator, left_value, right_value),
      left,
      right,
    ),
  );
}

function binary_expression(
  operator: string,
  left: FrontExpr,
  right: FrontExpr,
): FrontExpr {
  if (operator === "&&") {
    return {
      tag: "if",
      cond: left,
      then_branch: truth_expression(right),
      else_branch: { tag: "bool", value: false },
    };
  }
  if (operator === "||") {
    return {
      tag: "if",
      cond: left,
      then_branch: { tag: "bool", value: true },
      else_branch: truth_expression(right),
    };
  }
  const prim = binary_primitive(operator);
  expect(prim !== undefined, `Missing Baba binary primitive ${operator}.`);
  return { tag: "prim", prim, left, right };
}

function truth_expression(cond: FrontExpr): FrontExpr {
  return {
    tag: "if",
    cond,
    then_branch: { tag: "bool", value: true },
    else_branch: { tag: "bool", value: false },
  };
}

function binary_precedence(operator: string): number | undefined {
  if (operator === "||") return 1;
  if (operator === "&&") return 2;
  if (
    operator === "==" || operator === "!=" || operator === "<" ||
    operator === "<=" || operator === ">" || operator === ">="
  ) {
    return 3;
  }
  if (operator === "+" || operator === "-") return 4;
  if (operator === "*" || operator === "/" || operator === "%") return 5;
  return undefined;
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
    let pattern: Pattern;
    if (parameters.length === 0) {
      pattern = { tag: "unit" };
    } else if (parameters.length === 1) {
      const parameter = parameters[0];
      expect(
        parameter !== undefined,
        "Single-parameter Baba lambda lost its parameter.",
      );
      pattern = {
        tag: "binding",
        name: parameter.name,
        mode: "default",
        annotation: undefined,
      };
    } else {
      pattern = {
        tag: "product",
        entries: parameters.map((parameter) => ({
          pattern: {
            tag: "binding",
            name: parameter.name,
            mode: "default",
            annotation: undefined,
          },
        })),
        rest: undefined,
        value_pack: true,
      };
    }
    const expression: FrontExpr = {
      tag: "lam",
      pattern,
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
    node.kind === "condition_expression" ||
    node.kind === "identifier" ||
    node.kind === "intrinsic_identifier" ||
    node.kind === "number" ||
    node.kind === "boolean" ||
    node.kind === "string" ||
    node.kind === "unit_pattern" ||
    node.kind === "binary_expression" ||
    node.kind === "condition_binary_expression" ||
    node.kind === "arrow_function" ||
    node.kind === "application_expression" ||
    node.kind === "positional_product" ||
    node.kind === "block" ||
    node.kind === "if_expression" ||
    node.kind === "condition_unary_expression" ||
    node.kind === "array_expression" ||
    node.kind === "index_expression" ||
    node.kind === "import_expression" ||
    node.kind === "union_case" ||
    node.kind === "loop_expression";
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
