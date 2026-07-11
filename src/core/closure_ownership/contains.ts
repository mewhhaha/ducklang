import type { CoreExpr, CoreStmt } from "../ast.ts";

export function closure_body_contains_closure_value(expr: CoreExpr): boolean {
  switch (expr.tag) {
    case "lam":
    case "rec":
    case "rec_ref":
      return true;

    case "num":
    case "text":
    case "type_name":
    case "var":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return false;

    case "prim":
      for (const arg of expr.args) {
        if (closure_body_contains_closure_value(arg)) {
          return true;
        }
      }
      return false;

    case "app":
      if (closure_body_contains_closure_value(expr.func)) {
        return true;
      }

      for (const arg of expr.args) {
        if (closure_body_contains_closure_value(arg)) {
          return true;
        }
      }
      return false;

    case "block":
      for (const stmt of expr.statements) {
        if (closure_stmt_contains_closure_value(stmt)) {
          return true;
        }
      }
      return false;

    case "loop":
      for (const stmt of expr.body) {
        if (closure_stmt_contains_closure_value(stmt)) {
          return true;
        }
      }
      return false;

    case "comptime":
      return closure_body_contains_closure_value(expr.expr);

    case "borrow":
    case "freeze":
      return closure_body_contains_closure_value(expr.value);

    case "scratch":
      return closure_body_contains_closure_value(expr.body);

    case "with":
      if (closure_body_contains_closure_value(expr.base)) {
        return true;
      }
      return closure_fields_contain_closure_value(expr.fields);

    case "struct_value":
      if (closure_body_contains_closure_value(expr.type_expr)) {
        return true;
      }
      return closure_fields_contain_closure_value(expr.fields);

    case "struct_update":
      if (closure_body_contains_closure_value(expr.base)) {
        return true;
      }
      return closure_fields_contain_closure_value(expr.fields);

    case "if":
      return closure_body_contains_closure_value(expr.cond) ||
        closure_body_contains_closure_value(expr.then_branch) ||
        closure_body_contains_closure_value(expr.else_branch);

    case "if_let":
      return closure_body_contains_closure_value(expr.target) ||
        closure_body_contains_closure_value(expr.then_branch) ||
        closure_body_contains_closure_value(expr.else_branch);

    case "field":
      return closure_body_contains_closure_value(expr.object);

    case "index":
      return closure_body_contains_closure_value(expr.object) ||
        closure_body_contains_closure_value(expr.index);

    case "union_case":
      if (expr.value) {
        if (closure_body_contains_closure_value(expr.value)) {
          return true;
        }
      }

      if (expr.type_expr) {
        return closure_body_contains_closure_value(expr.type_expr);
      }

      return false;
  }
}

function closure_stmt_contains_closure_value(stmt: CoreStmt): boolean {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      return closure_body_contains_closure_value(stmt.value);

    case "index_assign":
      return closure_body_contains_closure_value(stmt.index) ||
        closure_body_contains_closure_value(stmt.value);

    case "type_check":
      return closure_body_contains_closure_value(stmt.target);

    case "expr":
      return closure_body_contains_closure_value(stmt.expr);

    case "return":
      return closure_body_contains_closure_value(stmt.value);

    case "range_loop":
      if (closure_body_contains_closure_value(stmt.start)) {
        return true;
      }

      if (closure_body_contains_closure_value(stmt.end)) {
        return true;
      }

      if (closure_body_contains_closure_value(stmt.step)) {
        return true;
      }

      for (const body_stmt of stmt.body) {
        if (closure_stmt_contains_closure_value(body_stmt)) {
          return true;
        }
      }

      return false;

    case "collection_loop":
      if (closure_body_contains_closure_value(stmt.collection)) {
        return true;
      }

      for (const body_stmt of stmt.body) {
        if (closure_stmt_contains_closure_value(body_stmt)) {
          return true;
        }
      }

      return false;

    case "if_stmt":
      if (closure_body_contains_closure_value(stmt.cond)) {
        return true;
      }

      for (const body_stmt of stmt.body) {
        if (closure_stmt_contains_closure_value(body_stmt)) {
          return true;
        }
      }

      return false;

    case "if_else_stmt":
      if (closure_body_contains_closure_value(stmt.cond)) {
        return true;
      }

      for (const body_stmt of stmt.then_body) {
        if (closure_stmt_contains_closure_value(body_stmt)) {
          return true;
        }
      }

      for (const body_stmt of stmt.else_body) {
        if (closure_stmt_contains_closure_value(body_stmt)) {
          return true;
        }
      }

      return false;

    case "if_let_stmt":
      if (closure_body_contains_closure_value(stmt.target)) {
        return true;
      }

      for (const body_stmt of stmt.body) {
        if (closure_stmt_contains_closure_value(body_stmt)) {
          return true;
        }
      }

      return false;

    case "break":
    case "continue":
    case "unsupported":
      return false;
  }
}

function closure_fields_contain_closure_value(
  fields: { value: CoreExpr }[],
): boolean {
  for (const field of fields) {
    if (closure_body_contains_closure_value(field.value)) {
      return true;
    }
  }

  return false;
}
