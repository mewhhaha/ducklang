import type { FrontExpr, FrontType, Source, Stmt } from "./ast.ts";

/** Small, best-effort facts safe to use while a document has syntax errors. */
export type SourceFacts = {
  type_of: WeakMap<object, FrontType>;
  nominal_of: WeakMap<object, string>;
  const_source_of: WeakMap<object, object>;
};

export function source_facts(source: Source): SourceFacts {
  const facts: SourceFacts = {
    type_of: new WeakMap(),
    nominal_of: new WeakMap(),
    const_source_of: new WeakMap(),
  };

  for (const statement of source.statements) {
    record_statement_facts(statement, facts);
  }
  return facts;
}

function record_statement_facts(statement: Stmt, facts: SourceFacts): void {
  if (statement.tag === "bind") {
    if (statement.annotation !== undefined) {
      facts.nominal_of.set(statement, statement.annotation);
      facts.nominal_of.set(statement.value, statement.annotation);
    }
    if (
      statement.type_annotation !== undefined &&
      statement.type_annotation.tag === "name"
    ) {
      facts.nominal_of.set(statement, statement.type_annotation.name);
      facts.nominal_of.set(statement.value, statement.type_annotation.name);
    }
    if (statement.kind === "const") {
      facts.const_source_of.set(statement, statement.value);
    }
    record_expr_facts(statement.value, facts);
    return;
  }
  if (
    statement.tag === "state_bind" || statement.tag === "bind_pattern" ||
    statement.tag === "resume_dup"
  ) {
    record_expr_facts(statement.value, facts);
    return;
  }
  if (statement.tag === "assign") {
    record_expr_facts(statement.value, facts);
    return;
  }
  if (statement.tag === "index_assign") {
    record_expr_facts(statement.index, facts);
    record_expr_facts(statement.value, facts);
    return;
  }
  if (statement.tag === "expr") return record_expr_facts(statement.expr, facts);
  if (statement.tag === "return") {
    return record_expr_facts(statement.value, facts);
  }
  if (statement.tag === "if_stmt") {
    record_expr_facts(statement.cond, facts);
    for (const child of statement.body) record_statement_facts(child, facts);
    return;
  }
  if (statement.tag === "if_let_stmt") {
    record_expr_facts(statement.target, facts);
    for (const child of statement.body) record_statement_facts(child, facts);
    return;
  }
  if (statement.tag === "for_range") {
    record_expr_facts(statement.start, facts);
    record_expr_facts(statement.end, facts);
    record_expr_facts(statement.step, facts);
    for (const child of statement.body) record_statement_facts(child, facts);
    return;
  }
  if (statement.tag === "for_collection") {
    record_expr_facts(statement.collection, facts);
    for (const child of statement.body) record_statement_facts(child, facts);
    return;
  }
  if (statement.tag === "type_check") {
    return record_expr_facts(statement.target, facts);
  }
  if (statement.tag === "break" && statement.value !== undefined) {
    record_expr_facts(statement.value, facts);
  }
}

function record_expr_facts(expr: FrontExpr, facts: SourceFacts): void {
  if (expr.tag === "struct_value") {
    if (expr.type_expr.tag === "type_name") {
      facts.nominal_of.set(expr, expr.type_expr.name);
    }

    facts.type_of.set(expr, {
      tag: "struct",
      fields: expr.fields.map((field) => field.name),
      field_types: undefined,
    });
  }
  if (expr.tag === "type_name") {
    facts.nominal_of.set(expr, expr.name);
    facts.type_of.set(expr, { tag: "type" });
  }
  if (expr.tag === "num") {
    facts.type_of.set(expr, { tag: "int", type: expr.type });
  }
  if (expr.tag === "text") facts.type_of.set(expr, { tag: "text" });
  if (expr.tag === "atom") {
    facts.type_of.set(expr, { tag: "atom", name: expr.name });
  }

  if (expr.tag === "prim") {
    record_expr_facts(expr.left, facts);
    record_expr_facts(expr.right, facts);
    return;
  }
  if (expr.tag === "app") {
    record_expr_facts(expr.func, facts);
    for (const arg of expr.args) record_expr_facts(arg, facts);
    return;
  }
  if (expr.tag === "block") {
    for (const statement of expr.statements) {
      record_statement_facts(statement, facts);
    }
    return;
  }
  if (expr.tag === "loop") {
    for (const statement of expr.body) {
      record_statement_facts(statement, facts);
    }
    return;
  }
  if (expr.tag === "lam" || expr.tag === "rec" || expr.tag === "scratch") {
    record_expr_facts(expr.body, facts);
    return;
  }
  if (expr.tag === "comptime") {
    record_expr_facts(expr.expr, facts);
    return;
  }
  if (expr.tag === "borrow" || expr.tag === "freeze") {
    record_expr_facts(expr.value, facts);
    return;
  }
  if (expr.tag === "captured") return record_expr_facts(expr.expr, facts);
  if (expr.tag === "field") return record_expr_facts(expr.object, facts);
  if (expr.tag === "index") {
    record_expr_facts(expr.object, facts);
    record_expr_facts(expr.index, facts);
    return;
  }
  if (expr.tag === "if") {
    record_expr_facts(expr.cond, facts);
    record_expr_facts(expr.then_branch, facts);
    record_expr_facts(expr.else_branch, facts);
    return;
  }
  if (expr.tag === "if_let") {
    record_expr_facts(expr.target, facts);
    record_expr_facts(expr.then_branch, facts);
    record_expr_facts(expr.else_branch, facts);
    return;
  }
  if (expr.tag === "struct_value") {
    record_expr_facts(expr.type_expr, facts);
    for (const field of expr.fields) record_expr_facts(field.value, facts);
    return;
  }
  if (expr.tag === "struct_update" || expr.tag === "with") {
    record_expr_facts(expr.base, facts);
    for (const field of expr.fields) record_expr_facts(field.value, facts);
    return;
  }
  if (expr.tag === "union_case") {
    if (expr.value !== undefined) record_expr_facts(expr.value, facts);
    if (expr.type_expr !== undefined) record_expr_facts(expr.type_expr, facts);
    return;
  }
  if (expr.tag === "try_with") {
    record_expr_facts(expr.body, facts);
    record_expr_facts(expr.handler, facts);
    return;
  }
  if (expr.tag === "handler") {
    for (const state of expr.state) record_expr_facts(state.value, facts);
    for (const clause of expr.clauses) record_expr_facts(clause.body, facts);
    record_expr_facts(expr.return_clause.body, facts);
  }
}
