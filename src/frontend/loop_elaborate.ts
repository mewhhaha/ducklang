import { expect } from "../expect.ts";
import type { FrontExpr, Param, Source, Stmt, TypeDeclaration } from "./ast.ts";
import {
  derive_missing_source_spans,
  has_source_span,
  source_span,
} from "./syntax.ts";
import {
  invalidate_source_facts,
  source_facts,
  source_type_display_name,
  type SourceFacts,
} from "./source_facts.ts";

export function elaborate_front_ranges(source: Source): Source {
  const facts = source_facts(source);
  const next_range = { value: 0 };
  elaborate_value(source.statements, next_range, facts);

  if (next_range.value > 0) {
    invalidate_source_facts(source);
  }

  return source;
}

export function elaborate_front_loops(source: Source): Source {
  derive_missing_source_spans(source, { start: 0, end: 0 });
  const facts = source_facts(source);
  const next_loop = { value: 0 };
  const generated_types: TypeDeclaration[] = [];
  elaborate_loops(source.statements, next_loop, facts, generated_types);

  if (next_loop.value > 0) {
    source.declarations = [
      ...(source.declarations || []),
      ...generated_types,
    ];
    invalidate_source_facts(source);
  }

  return source;
}

function elaborate_loops(
  value: unknown,
  next_loop: { value: number },
  facts: SourceFacts,
  generated_types: TypeDeclaration[],
): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      elaborate_loops(entry, next_loop, facts, generated_types);
    }
    return;
  }

  if ("tag" in value && value.tag === "comptime") {
    return;
  }

  if ("tag" in value && value.tag === "loop") {
    const expression = value as Extract<FrontExpr, { tag: "loop" }>;

    for (const statement of expression.body) {
      elaborate_loops(statement, next_loop, facts, generated_types);
    }

    const replacement = recursive_loop(
      expression,
      next_loop.value,
      facts,
      generated_types,
    );
    next_loop.value += 1;

    if (has_source_span(expression)) {
      derive_missing_source_spans(replacement, source_span(expression));
    }

    replace_node(expression, replacement);
    return;
  }

  for (const child of Object.values(value)) {
    elaborate_loops(child, next_loop, facts, generated_types);
  }
}

function elaborate_value(
  value: unknown,
  next_range: { value: number },
  facts: SourceFacts,
): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      elaborate_value(entry, next_range, facts);
    }
    return;
  }

  if ("tag" in value && value.tag === "comptime") {
    return;
  }

  if ("tag" in value && value.tag === "for_range") {
    const statement = value as Extract<Stmt, { tag: "for_range" }>;

    for (const body_statement of statement.body) {
      elaborate_value(body_statement, next_range, facts);
    }

    const replacement = range_loop(statement, next_range.value);
    next_range.value += 1;

    if (has_source_span(statement)) {
      derive_missing_source_spans(replacement, source_span(statement));
    }

    replace_node(statement, replacement);
    return;
  }

  if ("tag" in value && value.tag === "for_collection") {
    const statement = value as Extract<Stmt, { tag: "for_collection" }>;

    for (const body_statement of statement.body) {
      elaborate_value(body_statement, next_range, facts);
    }

    const replacement = collection_range(statement, next_range.value, facts);
    next_range.value += 1;

    if (has_source_span(statement)) {
      derive_missing_source_spans(replacement, source_span(statement));
    }

    replace_node(statement, replacement);
    elaborate_value(replacement, next_range, facts);
    return;
  }

  for (const child of Object.values(value)) {
    elaborate_value(child, next_range, facts);
  }
}

function collection_range(
  statement: Extract<Stmt, { tag: "for_collection" }>,
  id: number,
  facts: SourceFacts,
): Extract<Stmt, { tag: "expr" }> {
  const suffix = id.toString();
  const collection_name = "__duck_collection_" + suffix;
  let index_name = statement.index;

  if (index_name === undefined) {
    index_name = "__duck_collection_index_" + suffix;
  }

  const definition_types = facts.definition_type_of.get(statement);
  const item_type = definition_types?.get("item");
  let item_annotation: string | undefined;

  if (item_type !== undefined) {
    item_annotation = source_type_display_name(item_type);
  }

  return {
    tag: "expr",
    expr: {
      tag: "block",
      statements: [{
        tag: "bind",
        kind: "let",
        name: collection_name,
        is_linear: false,
        annotation: undefined,
        value: statement.collection,
      }, {
        tag: "for_range",
        index: index_name,
        start: { tag: "num", type: "i32", value: 0 },
        end: {
          tag: "app",
          func: { tag: "var", name: "@len" },
          args: [{ tag: "var", name: collection_name }],
        },
        end_bound: "exclusive",
        step: { tag: "num", type: "i32", value: 1 },
        body: [{
          tag: "bind",
          kind: "let",
          name: statement.item,
          is_linear: false,
          annotation: item_annotation,
          value: {
            tag: "index",
            object: { tag: "var", name: collection_name },
            index: { tag: "var", name: index_name },
          },
        }, ...statement.body],
      }],
    },
  };
}

function range_loop(
  statement: Extract<Stmt, { tag: "for_range" }>,
  id: number,
): Extract<Stmt, { tag: "expr" }> {
  const suffix = id.toString();
  const end_name = "__duck_range_end_" + suffix;
  const step_name = "__duck_range_step_" + suffix;
  const index_name = "__duck_range_index_" + suffix;
  const advance = range_advance(index_name, step_name);
  const body = rewrite_range_continues(statement.body, advance);
  const loop_body: Stmt[] = [
    {
      tag: "if_stmt",
      cond: {
        tag: "prim",
        prim: "i32.eq",
        left: { tag: "var", name: step_name },
        right: { tag: "num", type: "i32", value: 0 },
      },
      body: [{ tag: "break" }],
    },
    {
      tag: "if_stmt",
      cond: range_positive(step_name),
      body: [{
        tag: "if_stmt",
        cond: range_done(
          index_name,
          end_name,
          statement.end_bound,
          "ascending",
        ),
        body: [{ tag: "break" }],
      }],
    },
    {
      tag: "if_stmt",
      cond: range_negative(step_name),
      body: [{
        tag: "if_stmt",
        cond: range_done(
          index_name,
          end_name,
          statement.end_bound,
          "descending",
        ),
        body: [{ tag: "break" }],
      }],
    },
    {
      tag: "bind",
      kind: "let",
      name: statement.index,
      is_linear: false,
      annotation: "I32",
      value: { tag: "var", name: index_name },
    },
    ...body,
    advance,
  ];

  return {
    tag: "expr",
    expr: {
      tag: "block",
      statements: [
        range_binding(end_name, statement.end),
        range_binding(step_name, statement.step),
        range_binding(index_name, statement.start),
        { tag: "expr", expr: { tag: "loop", body: loop_body } },
      ],
    },
  };
}

function range_binding(
  name: string,
  value: FrontExpr,
): Extract<Stmt, { tag: "bind" }> {
  return {
    tag: "bind",
    kind: "let",
    name,
    is_linear: false,
    annotation: "I32",
    value,
  };
}

function range_advance(
  index_name: string,
  step_name: string,
): Extract<Stmt, { tag: "assign" }> {
  return {
    tag: "assign",
    name: index_name,
    mode: "same",
    value: {
      tag: "prim",
      prim: "i32.add",
      left: { tag: "var", name: index_name },
      right: { tag: "var", name: step_name },
    },
  };
}

function range_positive(step_name: string): FrontExpr {
  return {
    tag: "prim",
    prim: "i32.gt_s",
    left: { tag: "var", name: step_name },
    right: { tag: "num", type: "i32", value: 0 },
  };
}

function range_negative(step_name: string): FrontExpr {
  return {
    tag: "prim",
    prim: "i32.lt_s",
    left: { tag: "var", name: step_name },
    right: { tag: "num", type: "i32", value: 0 },
  };
}

function range_done(
  index_name: string,
  end_name: string,
  end_bound: "exclusive" | "inclusive",
  direction: "ascending" | "descending",
): FrontExpr {
  let prim: "i32.ge_s" | "i32.gt_s" | "i32.le_s" | "i32.lt_s";

  if (direction === "ascending") {
    if (end_bound === "inclusive") {
      prim = "i32.gt_s";
    } else {
      prim = "i32.ge_s";
    }
  } else if (end_bound === "inclusive") {
    prim = "i32.lt_s";
  } else {
    prim = "i32.le_s";
  }

  return {
    tag: "prim",
    prim,
    left: { tag: "var", name: index_name },
    right: { tag: "var", name: end_name },
  };
}

function rewrite_range_continues(
  statements: Stmt[],
  advance: Extract<Stmt, { tag: "assign" }>,
): Stmt[] {
  const result: Stmt[] = [];

  for (const statement of statements) {
    if (statement.tag === "continue") {
      result.push(structuredClone(advance), statement);
      continue;
    }

    if (statement.tag === "if_stmt" || statement.tag === "if_let_stmt") {
      result.push({
        ...statement,
        body: rewrite_range_continues(statement.body, advance),
      });
      continue;
    }

    if (statement.tag === "expr") {
      result.push({
        ...statement,
        expr: rewrite_range_continue_expr(statement.expr, advance),
      });
      continue;
    }

    result.push(statement);
  }

  return result;
}

function rewrite_range_continue_expr(
  expression: FrontExpr,
  advance: Extract<Stmt, { tag: "assign" }>,
): FrontExpr {
  if (expression.tag === "block") {
    return {
      ...expression,
      statements: rewrite_range_continues(expression.statements, advance),
    };
  }

  if (expression.tag === "if" || expression.tag === "if_let") {
    return {
      ...expression,
      then_branch: rewrite_range_continue_expr(
        expression.then_branch,
        advance,
      ),
      else_branch: rewrite_range_continue_expr(
        expression.else_branch,
        advance,
      ),
    };
  }

  return expression;
}

function replace_node(
  target: object,
  replacement: object,
): void {
  for (const key of Object.keys(target)) {
    delete (target as Record<string, unknown>)[key];
  }

  Object.assign(target, replacement);
  expect("tag" in target, "Loop replacement lost its syntax tag");
}

function recursive_loop(
  expression: Extract<FrontExpr, { tag: "loop" }>,
  id: number,
  facts: SourceFacts,
  generated_types: TypeDeclaration[],
): FrontExpr {
  const suffix = id.toString();
  const loop_name = "__duck_loop_" + suffix;
  const assigned_names = assigned_loop_names(expression.body);
  const assigned_types = assigned_names.map((name) =>
    assigned_loop_type(expression.body, name, facts)
  );
  const result_required = loop_returns_value(expression.body);
  const result_types = [...assigned_types];

  if (result_required) {
    result_types.unshift(loop_break_type(expression.body, facts));
  }

  let output_type_name: string | undefined;

  if (result_types.length > 1 && result_types.every(is_known_type)) {
    output_type_name = "_duck_loop_output_type_" + suffix;
    generated_types.push({
      tag: "type",
      name: output_type_name,
      params: [],
      body: {
        tag: "product",
        fields: result_types.map((type_name, index) => ({
          name: "item_" + index.toString(),
          type_name,
        })),
        positional: true,
      },
      recursive: false,
    });
  }

  const recursive_call = loop_call(loop_name, assigned_names);
  const body = loop_body_expression(
    expression.body,
    loop_name,
    assigned_names,
    result_required,
    output_type_name,
    recursive_call,
  );
  const params: Param[] = assigned_names.map((name, index) => ({
    name,
    is_const: false,
    is_linear: false,
    annotation: assigned_types[index],
  }));

  if (params.length === 0) {
    params.push({
      name: "__duck_loop_unit_" + suffix,
      is_const: false,
      is_linear: false,
      annotation: "Unit",
    });
  }

  let annotation: string | undefined;

  if (
    assigned_types.every(is_known_type) &&
    result_types.every(is_known_type)
  ) {
    annotation = function_annotation(
      assigned_types.length === 0 ? ["Unit"] : assigned_types,
      result_types.length === 0 ? ["Unit"] : result_types,
      output_type_name,
    );
  }

  const statements: Stmt[] = [{
    tag: "bind",
    kind: "let",
    name: loop_name,
    is_recursive: true,
    is_linear: false,
    annotation,
    value: {
      tag: "lam",
      params,
      body,
    },
  }];
  const call = loop_call(loop_name, assigned_names);
  const output_names: string[] = [];

  if (result_required) {
    output_names.push("__duck_loop_result_" + suffix);
  }

  for (let index = 0; index < assigned_names.length; index += 1) {
    output_names.push(
      "__duck_loop_state_" + suffix + "_" + index.toString(),
    );
  }

  if (output_names.length === 0) {
    statements.push({ tag: "expr", expr: call });
    return { tag: "block", statements };
  }

  if (output_names.length === 1) {
    const output_name = output_names[0];
    expect(output_name, "Loop output requires a name");
    statements.push({
      tag: "bind",
      kind: "let",
      name: output_name,
      is_linear: false,
      annotation: result_types[0],
      value: call,
    });
  } else {
    statements.push({
      tag: "bind",
      kind: "let",
      name: "__duck_loop_outputs_" + suffix,
      is_linear: false,
      annotation: output_type_name || value_pack_type(result_types),
      pattern: {
        tag: "product",
        entries: output_names.map((name) => ({
          pattern: {
            tag: "binding",
            name,
            mode: "default",
            annotation: undefined,
          },
        })),
      },
      value: call,
    });
  }

  const state_offset = result_required ? 1 : 0;

  for (let index = 0; index < assigned_names.length; index += 1) {
    const name = assigned_names[index];
    const output_name = output_names[index + state_offset];
    expect(name, "Loop state requires a source name");
    expect(output_name, "Loop state requires an output name");
    statements.push({
      tag: "assign",
      name,
      mode: "same",
      value: { tag: "var", name: output_name },
    });
  }

  if (result_required) {
    const result_name = output_names[0];
    expect(result_name, "Loop result requires an output name");
    statements.push({
      tag: "expr",
      expr: { tag: "var", name: result_name },
    });
  } else {
    statements.push({ tag: "expr", expr: { tag: "unit" } });
  }

  return { tag: "block", statements };
}

function value_pack_type(types: (string | undefined)[]): string | undefined {
  if (!types.every(is_known_type)) {
    return undefined;
  }

  if (types.length === 1) {
    return types[0];
  }

  return "(" + types.join(", ") + ")";
}

function assigned_loop_type(
  statements: Stmt[],
  name: string,
  facts: SourceFacts,
): string | undefined {
  for (const statement of statements) {
    if (statement.tag === "assign" && statement.name === name) {
      let type = facts.editor_type_of.get(statement.value);

      if (type === undefined || type.name === "unknown") {
        type = facts.expected_type_of.get(statement.value);
      }

      if (type !== undefined && type.name !== "unknown") {
        return source_type_display_name(type);
      }
    }

    if (statement.tag === "if_stmt" || statement.tag === "if_let_stmt") {
      const type = assigned_loop_type(statement.body, name, facts);

      if (type !== undefined) {
        return type;
      }
    }

    if (statement.tag === "expr") {
      const type = assigned_loop_expression_type(
        statement.expr,
        name,
        facts,
      );

      if (type !== undefined) {
        return type;
      }
    }
  }

  const referenced_type = referenced_loop_type(statements, name, facts);

  if (referenced_type !== undefined) {
    return referenced_type;
  }

  const assignment = loop_assignment(statements, name);

  if (assignment !== undefined) {
    const assignment_index = facts.statements.indexOf(assignment);

    for (let index = assignment_index - 1; index >= 0; index -= 1) {
      const statement = facts.statements[index];

      if (statement?.tag !== "bind" || statement.name !== name) {
        continue;
      }

      const type = facts.definition_type_of.get(statement)?.get("name");

      if (type !== undefined && type.name !== "unknown") {
        return source_type_display_name(type);
      }
    }
  }

  return undefined;
}

function referenced_loop_type(
  value: unknown,
  name: string,
  facts: SourceFacts,
): string | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const type = referenced_loop_type(entry, name, facts);

      if (type !== undefined) {
        return type;
      }
    }

    return undefined;
  }

  if ("tag" in value && value.tag === "var" && "name" in value) {
    if (value.name === name) {
      const type = facts.editor_type_of.get(value);

      if (type !== undefined && type.name !== "unknown") {
        return source_type_display_name(type);
      }
    }
  }

  if (
    "tag" in value &&
    (value.tag === "lam" || value.tag === "rec" || value.tag === "handler")
  ) {
    return undefined;
  }

  for (const child of Object.values(value)) {
    const type = referenced_loop_type(child, name, facts);

    if (type !== undefined) {
      return type;
    }
  }

  return undefined;
}

function loop_assignment(
  statements: Stmt[],
  name: string,
): Extract<Stmt, { tag: "assign" }> | undefined {
  for (const statement of statements) {
    if (statement.tag === "assign" && statement.name === name) {
      return statement;
    }

    if (statement.tag === "if_stmt" || statement.tag === "if_let_stmt") {
      const assignment = loop_assignment(statement.body, name);

      if (assignment !== undefined) {
        return assignment;
      }
    }

    if (statement.tag === "expr") {
      const assignment = loop_expression_assignment(statement.expr, name);

      if (assignment !== undefined) {
        return assignment;
      }
    }
  }

  return undefined;
}

function loop_expression_assignment(
  expression: FrontExpr,
  name: string,
): Extract<Stmt, { tag: "assign" }> | undefined {
  if (expression.tag === "block") {
    return loop_assignment(expression.statements, name);
  }

  if (expression.tag === "if" || expression.tag === "if_let") {
    const assignment = loop_expression_assignment(
      expression.then_branch,
      name,
    );

    if (assignment !== undefined) {
      return assignment;
    }

    return loop_expression_assignment(expression.else_branch, name);
  }

  if (expression.tag === "match") {
    for (const arm of expression.arms) {
      const assignment = loop_expression_assignment(arm.body, name);

      if (assignment !== undefined) {
        return assignment;
      }
    }
  }

  return undefined;
}

function assigned_loop_expression_type(
  expression: FrontExpr,
  name: string,
  facts: SourceFacts,
): string | undefined {
  if (expression.tag === "block") {
    return assigned_loop_type(expression.statements, name, facts);
  }

  if (expression.tag === "if" || expression.tag === "if_let") {
    const then_type = assigned_loop_expression_type(
      expression.then_branch,
      name,
      facts,
    );

    if (then_type !== undefined) {
      return then_type;
    }

    return assigned_loop_expression_type(
      expression.else_branch,
      name,
      facts,
    );
  }

  if (expression.tag === "match") {
    for (const arm of expression.arms) {
      const type = assigned_loop_expression_type(arm.body, name, facts);

      if (type !== undefined) {
        return type;
      }
    }
  }

  return undefined;
}

function loop_break_type(
  statements: Stmt[],
  facts: SourceFacts,
): string | undefined {
  for (const statement of statements) {
    if (statement.tag === "break" && statement.value !== undefined) {
      const type = facts.editor_type_of.get(statement.value);

      if (type !== undefined && type.name !== "unknown") {
        return source_type_display_name(type);
      }
    }

    if (statement.tag === "if_stmt" || statement.tag === "if_let_stmt") {
      const type = loop_break_type(statement.body, facts);

      if (type !== undefined) {
        return type;
      }
    }

    if (statement.tag === "expr") {
      const type = loop_break_expression_type(statement.expr, facts);

      if (type !== undefined) {
        return type;
      }
    }
  }

  return undefined;
}

function loop_break_expression_type(
  expression: FrontExpr,
  facts: SourceFacts,
): string | undefined {
  if (expression.tag === "block") {
    return loop_break_type(expression.statements, facts);
  }

  if (expression.tag === "if" || expression.tag === "if_let") {
    const then_type = loop_break_expression_type(
      expression.then_branch,
      facts,
    );

    if (then_type !== undefined) {
      return then_type;
    }

    return loop_break_expression_type(expression.else_branch, facts);
  }

  if (expression.tag === "match") {
    for (const arm of expression.arms) {
      const type = loop_break_expression_type(arm.body, facts);

      if (type !== undefined) {
        return type;
      }
    }
  }

  return undefined;
}

function is_known_type(type: string | undefined): type is string {
  return type !== undefined && type !== "unknown";
}

function function_annotation(
  params: string[],
  results: string[],
  output_type_name: string | undefined,
): string {
  let result = results[0];

  if (results.length > 1) {
    result = output_type_name || "[" + results.join(", ") + "]";
  }

  expect(result, "Loop function requires a result type");
  return params.join(" -> ") + " -> " + result;
}

function assigned_loop_names(statements: Stmt[]): string[] {
  const assigned = new Set<string>();
  const local = new Set<string>();
  collect_loop_bindings_and_assignments(statements, assigned, local);
  return [...assigned].filter((name) => !local.has(name));
}

function collect_loop_bindings_and_assignments(
  value: unknown,
  assigned: Set<string>,
  local: Set<string>,
): void {
  if (value === null || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collect_loop_bindings_and_assignments(entry, assigned, local);
    }
    return;
  }

  if ("tag" in value) {
    if (
      (value.tag === "assign" || value.tag === "index_assign") &&
      "name" in value && typeof value.name === "string"
    ) {
      assigned.add(value.name);
    }

    if (
      value.tag === "bind" && "name" in value &&
      typeof value.name === "string"
    ) {
      local.add(value.name);
    }

    if (
      value.tag === "lam" || value.tag === "rec" || value.tag === "handler"
    ) {
      return;
    }
  }

  for (const child of Object.values(value)) {
    collect_loop_bindings_and_assignments(child, assigned, local);
  }
}

function loop_returns_value(statements: Stmt[]): boolean {
  for (const statement of statements) {
    if (statement.tag === "break" && statement.value !== undefined) {
      return true;
    }

    if (
      (statement.tag === "if_stmt" || statement.tag === "if_let_stmt") &&
      loop_returns_value(statement.body)
    ) {
      return true;
    }

    if (
      statement.tag === "expr" &&
      loop_expr_returns_value(statement.expr)
    ) {
      return true;
    }
  }

  return false;
}

function loop_expr_returns_value(expression: FrontExpr): boolean {
  if (expression.tag === "block") {
    return loop_returns_value(expression.statements);
  }

  if (expression.tag === "if" || expression.tag === "if_let") {
    return loop_expr_returns_value(expression.then_branch) ||
      loop_expr_returns_value(expression.else_branch);
  }

  return false;
}

function loop_body_expression(
  statements: Stmt[],
  loop_name: string,
  assigned_names: string[],
  result_required: boolean,
  output_type_name: string | undefined,
  continuation: FrontExpr,
): FrontExpr {
  const statement = statements[0];

  if (statement === undefined) {
    return continuation;
  }

  if (statement.tag === "break") {
    let result: FrontExpr = { tag: "unit" };

    if (statement.value !== undefined) {
      result = statement.value;
    }

    return loop_output(
      result,
      assigned_names,
      result_required,
      output_type_name,
    );
  }

  if (statement.tag === "continue") {
    return loop_call(loop_name, assigned_names);
  }

  const remaining = statements.slice(1);

  if (statement.tag === "if_stmt") {
    return {
      tag: "if",
      cond: statement.cond,
      then_branch: loop_body_expression(
        statement.body,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
        loop_body_expression(
          remaining,
          loop_name,
          assigned_names,
          result_required,
          output_type_name,
          continuation,
        ),
      ),
      else_branch: loop_body_expression(
        remaining,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
        continuation,
      ),
    };
  }

  if (statement.tag === "if_let_stmt") {
    return {
      tag: "if_let",
      case_name: statement.case_name,
      value_name: statement.value_name,
      target: statement.target,
      then_branch: loop_body_expression(
        statement.body,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
        loop_body_expression(
          remaining,
          loop_name,
          assigned_names,
          result_required,
          output_type_name,
          continuation,
        ),
      ),
      else_branch: loop_body_expression(
        remaining,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
        continuation,
      ),
    };
  }

  const rest = loop_body_expression(
    remaining,
    loop_name,
    assigned_names,
    result_required,
    output_type_name,
    continuation,
  );

  if (statement.tag === "expr") {
    return loop_expression_then(
      statement.expr,
      rest,
      loop_name,
      assigned_names,
      result_required,
      output_type_name,
    );
  }

  return {
    tag: "block",
    statements: [
      statement,
      { tag: "expr", expr: rest },
    ],
  };
}

function loop_expression_then(
  expression: FrontExpr,
  continuation: FrontExpr,
  loop_name: string,
  assigned_names: string[],
  result_required: boolean,
  output_type_name: string | undefined,
): FrontExpr {
  if (expression.tag === "block") {
    return loop_body_expression(
      expression.statements,
      loop_name,
      assigned_names,
      result_required,
      output_type_name,
      continuation,
    );
  }

  if (expression.tag === "if") {
    return {
      ...expression,
      then_branch: loop_expression_then(
        expression.then_branch,
        continuation,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
      ),
      else_branch: loop_expression_then(
        expression.else_branch,
        continuation,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
      ),
    };
  }

  if (expression.tag === "if_let") {
    return {
      ...expression,
      then_branch: loop_expression_then(
        expression.then_branch,
        continuation,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
      ),
      else_branch: loop_expression_then(
        expression.else_branch,
        continuation,
        loop_name,
        assigned_names,
        result_required,
        output_type_name,
      ),
    };
  }

  if (expression.tag === "match") {
    return {
      ...expression,
      arms: expression.arms.map((arm) => ({
        ...arm,
        body: loop_expression_then(
          arm.body,
          continuation,
          loop_name,
          assigned_names,
          result_required,
          output_type_name,
        ),
      })),
    };
  }

  return {
    tag: "block",
    statements: [
      { tag: "expr", expr: expression },
      { tag: "expr", expr: continuation },
    ],
  };
}

function loop_output(
  result: FrontExpr,
  assigned_names: string[],
  result_required: boolean,
  output_type_name: string | undefined,
): FrontExpr {
  const values = assigned_names.map<FrontExpr>((name) => ({
    tag: "var",
    name,
  }));

  if (result_required) {
    values.unshift(result);
  }

  if (values.length === 0) {
    return { tag: "unit" };
  }

  if (values.length === 1) {
    const value = values[0];
    expect(value, "Loop output requires a value");
    return value;
  }

  if (output_type_name !== undefined) {
    return {
      tag: "struct_value",
      type_expr: { tag: "var", name: output_type_name },
      fields: values.map((value, index) => ({
        name: "item_" + index.toString(),
        value,
      })),
      bracketed: "positional",
    };
  }

  return {
    tag: "product",
    entries: values.map((value) => ({ value })),
  };
}

function loop_call(
  loop_name: string,
  assigned_names: string[],
): Extract<FrontExpr, { tag: "app" }> {
  let args: FrontExpr[] = assigned_names.map((name) => ({
    tag: "var",
    name,
  }));

  if (args.length === 0) {
    args = [{ tag: "unit" }];
  }

  return {
    tag: "app",
    func: { tag: "var", name: loop_name },
    args,
  };
}
