import type { Core, CoreExpr, CoreStmt } from "./ast.ts";

export function core_mutable_bindings(core: Core): Set<string> {
  const result = new Set<string>();
  for (const stmt of core.statements) {
    collect_rebound_names(stmt, result);
  }
  if (core.capability_methods) {
    for (const method of core.capability_methods) {
      if (method.representation === "runtime_aggregate") {
        result.add(method.table);
      }
    }
  }
  return result;
}

export function core_materialized_bindings(core: Core): Set<string> {
  const union_types = new Set<string>();
  for (const stmt of core.statements) {
    if (
      stmt.tag === "bind" && stmt.kind === "const" &&
      stmt.value.tag === "union_type"
    ) {
      union_types.add(stmt.name);
    }
  }
  const result = new Set<string>();
  for (const stmt of core.statements) {
    collect_materialized_stmt_bindings(stmt, union_types, result);
  }
  return result;
}

function collect_materialized_stmt_bindings(
  stmt: CoreStmt,
  union_types: Set<string>,
  result: Set<string>,
): void {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      collect_materialized_expr_bindings(stmt.value, union_types, result);
      return;

    case "index_assign":
      collect_materialized_expr_bindings(stmt.index, union_types, result);
      collect_materialized_expr_bindings(stmt.value, union_types, result);
      return;

    case "range_loop":
      collect_materialized_expr_bindings(stmt.start, union_types, result);
      collect_materialized_expr_bindings(stmt.end, union_types, result);
      collect_materialized_expr_bindings(stmt.step, union_types, result);
      for (const child of stmt.body) {
        collect_materialized_stmt_bindings(child, union_types, result);
      }
      return;

    case "collection_loop":
      collect_materialized_expr_bindings(stmt.collection, union_types, result);
      for (const child of stmt.body) {
        collect_materialized_stmt_bindings(child, union_types, result);
      }
      return;

    case "if_stmt":
      collect_materialized_expr_bindings(stmt.cond, union_types, result);
      for (const child of stmt.body) {
        collect_materialized_stmt_bindings(child, union_types, result);
      }
      return;

    case "if_else_stmt":
      collect_materialized_expr_bindings(stmt.cond, union_types, result);
      for (const child of stmt.then_body) {
        collect_materialized_stmt_bindings(child, union_types, result);
      }
      for (const child of stmt.else_body) {
        collect_materialized_stmt_bindings(child, union_types, result);
      }
      return;

    case "if_let_stmt":
      collect_materialized_expr_bindings(stmt.target, union_types, result);
      for (const child of stmt.body) {
        collect_materialized_stmt_bindings(child, union_types, result);
      }
      return;

    case "type_check":
      collect_materialized_expr_bindings(stmt.target, union_types, result);
      return;

    case "break":
      if (stmt.value) {
        collect_materialized_expr_bindings(stmt.value, union_types, result);
      }
      return;

    case "return":
      collect_materialized_expr_bindings(stmt.value, union_types, result);
      return;

    case "expr":
      collect_materialized_expr_bindings(stmt.expr, union_types, result);
      return;

    case "continue":
    case "unsupported":
      return;
  }
}

function collect_materialized_expr_bindings(
  expr: CoreExpr,
  union_types: Set<string>,
  result: Set<string>,
): void {
  if (expr.tag === "union_case" && expr.value) {
    const owner = named_union_payload_binding(expr.value);
    if (owner) {
      result.add(owner);
    }
  }
  if (
    expr.tag === "app" && expr.func.tag === "field" &&
    expr.func.object.tag === "var" &&
    union_types.has(expr.func.object.name)
  ) {
    const payload = expr.args[0];
    if (payload) {
      const owner = named_union_payload_binding(payload);
      if (owner) {
        result.add(owner);
      }
    }
  }

  switch (expr.tag) {
    case "num":
    case "text":
    case "var":
    case "linear":
    case "type_name":
    case "rec_ref":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "prim":
      for (const arg of expr.args) {
        collect_materialized_expr_bindings(arg, union_types, result);
      }
      return;

    case "lam":
    case "rec":
      collect_materialized_expr_bindings(expr.body, union_types, result);
      return;

    case "app":
      collect_materialized_expr_bindings(expr.func, union_types, result);
      for (const arg of expr.args) {
        collect_materialized_expr_bindings(arg, union_types, result);
      }
      return;

    case "block":
      for (const stmt of expr.statements) {
        collect_materialized_stmt_bindings(stmt, union_types, result);
      }
      return;

    case "loop":
      for (const stmt of expr.body) {
        collect_materialized_stmt_bindings(stmt, union_types, result);
      }
      return;

    case "comptime":
      collect_materialized_expr_bindings(expr.expr, union_types, result);
      return;

    case "borrow":
    case "freeze":
      collect_materialized_expr_bindings(expr.value, union_types, result);
      return;

    case "scratch":
      collect_materialized_expr_bindings(expr.body, union_types, result);
      return;

    case "with":
      collect_materialized_expr_bindings(expr.base, union_types, result);
      for (const field of expr.fields) {
        collect_materialized_expr_bindings(field.value, union_types, result);
      }
      return;

    case "struct_value":
      collect_materialized_expr_bindings(expr.type_expr, union_types, result);
      for (const field of expr.fields) {
        collect_materialized_expr_bindings(field.value, union_types, result);
      }
      return;

    case "struct_update":
      collect_materialized_expr_bindings(expr.base, union_types, result);
      for (const field of expr.fields) {
        collect_materialized_expr_bindings(field.value, union_types, result);
      }
      return;

    case "if":
      collect_materialized_expr_bindings(expr.cond, union_types, result);
      collect_materialized_expr_bindings(expr.then_branch, union_types, result);
      collect_materialized_expr_bindings(expr.else_branch, union_types, result);
      return;

    case "if_let":
      collect_materialized_expr_bindings(expr.target, union_types, result);
      collect_materialized_expr_bindings(expr.then_branch, union_types, result);
      collect_materialized_expr_bindings(expr.else_branch, union_types, result);
      return;

    case "field":
      collect_materialized_expr_bindings(expr.object, union_types, result);
      return;

    case "index":
      collect_materialized_expr_bindings(expr.object, union_types, result);
      collect_materialized_expr_bindings(expr.index, union_types, result);
      return;

    case "union_case":
      if (expr.value) {
        collect_materialized_expr_bindings(expr.value, union_types, result);
      }
      if (expr.type_expr) {
        collect_materialized_expr_bindings(expr.type_expr, union_types, result);
      }
      return;
  }
}

function named_union_payload_binding(value: CoreExpr): string | undefined {
  if (value.tag === "var" || value.tag === "linear") {
    return value.name;
  }
  if (value.tag !== "block") {
    return undefined;
  }
  const aliases = new Map<string, string>();
  for (const stmt of value.statements) {
    if (
      stmt.tag === "bind" &&
      (stmt.value.tag === "var" || stmt.value.tag === "linear")
    ) {
      aliases.set(stmt.name, stmt.value.name);
    }
  }
  const final_stmt = value.statements[value.statements.length - 1];
  if (!final_stmt) {
    return undefined;
  }
  let final_value: CoreExpr | undefined;
  if (final_stmt.tag === "expr") {
    final_value = final_stmt.expr;
  } else if (final_stmt.tag === "return") {
    final_value = final_stmt.value;
  }
  if (
    !final_value ||
    (final_value.tag !== "var" && final_value.tag !== "linear")
  ) {
    return undefined;
  }
  const seen = new Set<string>();
  let name = final_value.name;
  while (aliases.has(name)) {
    if (seen.has(name)) {
      throw new Error("Recursive union payload alias: " + name);
    }
    seen.add(name);
    const source = aliases.get(name);
    if (!source) {
      throw new Error("Missing union payload alias source: " + name);
    }
    name = source;
  }
  return name;
}

function collect_rebound_names(stmt: CoreStmt, result: Set<string>): void {
  switch (stmt.tag) {
    case "assign":
      result.add(stmt.name);
      return;

    case "range_loop":
    case "collection_loop":
      for (const name of stmt.carried) {
        result.add(name);
      }
      return;

    case "if_stmt":
    case "if_let_stmt":
      for (const child of stmt.body) {
        collect_rebound_names(child, result);
      }
      return;

    case "if_else_stmt":
      for (const child of stmt.then_body) {
        collect_rebound_names(child, result);
      }
      for (const child of stmt.else_body) {
        collect_rebound_names(child, result);
      }
      return;

    case "bind":
    case "index_assign":
    case "type_check":
    case "break":
    case "continue":
    case "return":
    case "expr":
    case "unsupported":
      return;
  }
}
