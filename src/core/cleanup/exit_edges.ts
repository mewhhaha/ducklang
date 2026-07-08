import type { CoreExpr, CoreField, CoreStmt } from "../ast.ts";

export type CoreCleanupExitEdge =
  | "fallthrough"
  | "return"
  | "break"
  | "continue";

export function core_scratch_exit_edges(expr: CoreExpr): CoreCleanupExitEdge[] {
  const edges = new Set<CoreCleanupExitEdge>();
  edges.add("fallthrough");
  collect_expr_exit_edges(expr, edges, 0);
  return ordered_exit_edges(edges);
}

function collect_expr_exit_edges(
  expr: CoreExpr,
  edges: Set<CoreCleanupExitEdge>,
  loop_depth: number,
): void {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "var":
    case "linear":
    case "lam":
    case "rec":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "prim":
      for (const arg of expr.args) {
        collect_expr_exit_edges(arg, edges, loop_depth);
      }
      return;

    case "app":
      collect_expr_exit_edges(expr.func, edges, loop_depth);
      for (const arg of expr.args) {
        collect_expr_exit_edges(arg, edges, loop_depth);
      }
      return;

    case "block":
      collect_stmt_exit_edges(expr.statements, edges, loop_depth);
      return;

    case "comptime":
      collect_expr_exit_edges(expr.expr, edges, loop_depth);
      return;

    case "borrow":
    case "freeze":
      collect_expr_exit_edges(expr.value, edges, loop_depth);
      return;

    case "scratch":
      collect_expr_exit_edges(expr.body, edges, loop_depth);
      return;

    case "with":
      collect_expr_exit_edges(expr.base, edges, loop_depth);
      collect_field_exit_edges(expr.fields, edges, loop_depth);
      return;

    case "struct_value":
      collect_expr_exit_edges(expr.type_expr, edges, loop_depth);
      collect_field_exit_edges(expr.fields, edges, loop_depth);
      return;

    case "struct_update":
      collect_expr_exit_edges(expr.base, edges, loop_depth);
      collect_field_exit_edges(expr.fields, edges, loop_depth);
      return;

    case "if":
      collect_expr_exit_edges(expr.cond, edges, loop_depth);
      collect_expr_exit_edges(expr.then_branch, edges, loop_depth);
      collect_expr_exit_edges(expr.else_branch, edges, loop_depth);
      return;

    case "if_let":
      collect_expr_exit_edges(expr.target, edges, loop_depth);
      collect_expr_exit_edges(expr.then_branch, edges, loop_depth);
      collect_expr_exit_edges(expr.else_branch, edges, loop_depth);
      return;

    case "field":
      collect_expr_exit_edges(expr.object, edges, loop_depth);
      return;

    case "index":
      collect_expr_exit_edges(expr.object, edges, loop_depth);
      collect_expr_exit_edges(expr.index, edges, loop_depth);
      return;

    case "union_case":
      if (expr.value) {
        collect_expr_exit_edges(expr.value, edges, loop_depth);
      }

      if (expr.type_expr) {
        collect_expr_exit_edges(expr.type_expr, edges, loop_depth);
      }
      return;
  }
}

function collect_stmt_exit_edges(
  statements: CoreStmt[],
  edges: Set<CoreCleanupExitEdge>,
  loop_depth: number,
): void {
  for (const stmt of statements) {
    collect_one_stmt_exit_edges(stmt, edges, loop_depth);
  }
}

function collect_one_stmt_exit_edges(
  stmt: CoreStmt,
  edges: Set<CoreCleanupExitEdge>,
  loop_depth: number,
): void {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      collect_expr_exit_edges(stmt.value, edges, loop_depth);
      return;

    case "index_assign":
      collect_expr_exit_edges(stmt.index, edges, loop_depth);
      collect_expr_exit_edges(stmt.value, edges, loop_depth);
      return;

    case "range_loop":
      collect_expr_exit_edges(stmt.start, edges, loop_depth);
      collect_expr_exit_edges(stmt.end, edges, loop_depth);
      collect_expr_exit_edges(stmt.step, edges, loop_depth);
      collect_stmt_exit_edges(stmt.body, edges, loop_depth + 1);
      return;

    case "collection_loop":
      collect_expr_exit_edges(stmt.collection, edges, loop_depth);
      collect_stmt_exit_edges(stmt.body, edges, loop_depth + 1);
      return;

    case "if_stmt":
      collect_expr_exit_edges(stmt.cond, edges, loop_depth);
      collect_stmt_exit_edges(stmt.body, edges, loop_depth);
      return;

    case "if_else_stmt":
      collect_expr_exit_edges(stmt.cond, edges, loop_depth);
      collect_stmt_exit_edges(stmt.then_body, edges, loop_depth);
      collect_stmt_exit_edges(stmt.else_body, edges, loop_depth);
      return;

    case "if_let_stmt":
      collect_expr_exit_edges(stmt.target, edges, loop_depth);
      collect_stmt_exit_edges(stmt.body, edges, loop_depth);
      return;

    case "type_check":
      collect_expr_exit_edges(stmt.target, edges, loop_depth);
      return;

    case "break":
      if (loop_depth === 0) {
        edges.add("break");
      }
      return;

    case "continue":
      if (loop_depth === 0) {
        edges.add("continue");
      }
      return;

    case "return":
      edges.add("return");
      collect_expr_exit_edges(stmt.value, edges, loop_depth);
      return;

    case "expr":
      collect_expr_exit_edges(stmt.expr, edges, loop_depth);
      return;

    case "unsupported":
      return;
  }
}

function collect_field_exit_edges(
  fields: CoreField[],
  edges: Set<CoreCleanupExitEdge>,
  loop_depth: number,
): void {
  for (const field of fields) {
    collect_expr_exit_edges(field.value, edges, loop_depth);
  }
}

function ordered_exit_edges(
  edges: Set<CoreCleanupExitEdge>,
): CoreCleanupExitEdge[] {
  const ordered: CoreCleanupExitEdge[] = [];

  if (edges.has("fallthrough")) {
    ordered.push("fallthrough");
  }

  if (edges.has("return")) {
    ordered.push("return");
  }

  if (edges.has("break")) {
    ordered.push("break");
  }

  if (edges.has("continue")) {
    ordered.push("continue");
  }

  return ordered;
}
