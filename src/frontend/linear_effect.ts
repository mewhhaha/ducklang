import type { FrontExpr, Stmt } from "./ast.ts";

export function contains_reserved_linear_effect(
  expr: FrontExpr,
  names: Set<string>,
): boolean {
  switch (expr.tag) {
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
      return contains_reserved_linear_effect(expr.left, names) ||
        contains_reserved_linear_effect(expr.right, names);

    case "lam":
    case "rec":
      return false;

    case "app": {
      if (expr.func.tag === "field") {
        if (uses_linear_name(expr.func.object, names)) {
          return true;
        }
      }

      if (contains_reserved_linear_effect(expr.func, names)) {
        return true;
      }

      for (const arg of expr.args) {
        if (contains_reserved_linear_effect(arg, names)) {
          return true;
        }
      }

      return false;
    }

    case "block":
      return contains_reserved_linear_stmt(expr.statements, names);

    case "comptime":
      return contains_reserved_linear_effect(expr.expr, names);

    case "borrow":
      return contains_reserved_linear_effect(expr.value, names);

    case "freeze":
      return contains_reserved_linear_effect(expr.value, names);

    case "scratch":
      return contains_reserved_linear_effect(expr.body, names);

    case "captured":
      return contains_reserved_linear_effect(expr.expr, names);

    case "with": {
      if (contains_reserved_linear_effect(expr.base, names)) {
        return true;
      }

      for (const field of expr.fields) {
        if (contains_reserved_linear_effect(field.value, names)) {
          return true;
        }
      }

      return false;
    }

    case "struct_value": {
      if (contains_reserved_linear_effect(expr.type_expr, names)) {
        return true;
      }

      for (const field of expr.fields) {
        if (contains_reserved_linear_effect(field.value, names)) {
          return true;
        }
      }

      return false;
    }

    case "struct_update": {
      if (contains_reserved_linear_effect(expr.base, names)) {
        return true;
      }

      for (const field of expr.fields) {
        if (contains_reserved_linear_effect(field.value, names)) {
          return true;
        }
      }

      return false;
    }

    case "if":
      return contains_reserved_linear_effect(expr.cond, names) ||
        contains_reserved_linear_effect(expr.then_branch, names) ||
        contains_reserved_linear_effect(expr.else_branch, names);

    case "if_let":
      return contains_reserved_linear_effect(expr.target, names) ||
        contains_reserved_linear_effect(expr.then_branch, names) ||
        contains_reserved_linear_effect(expr.else_branch, names);

    case "field":
      return contains_reserved_linear_effect(expr.object, names);

    case "index":
      return contains_reserved_linear_effect(expr.object, names) ||
        contains_reserved_linear_effect(expr.index, names);

    case "union_case":
      if (!expr.value) {
        return false;
      }

      return contains_reserved_linear_effect(expr.value, names);
  }
}

function contains_reserved_linear_stmt(
  stmts: Stmt[],
  names: Set<string>,
): boolean {
  for (const stmt of stmts) {
    if (stmt.tag === "bind") {
      if (contains_reserved_linear_effect(stmt.value, names)) {
        return true;
      }
    } else if (stmt.tag === "assign") {
      if (contains_reserved_linear_effect(stmt.value, names)) {
        return true;
      }
    } else if (stmt.tag === "index_assign") {
      if (
        contains_reserved_linear_effect(stmt.index, names) ||
        contains_reserved_linear_effect(stmt.value, names)
      ) {
        return true;
      }
    } else if (stmt.tag === "return") {
      if (contains_reserved_linear_effect(stmt.value, names)) {
        return true;
      }
    } else if (stmt.tag === "expr") {
      if (contains_reserved_linear_effect(stmt.expr, names)) {
        return true;
      }
    } else if (stmt.tag === "for_range") {
      if (
        contains_reserved_linear_effect(stmt.start, names) ||
        contains_reserved_linear_effect(stmt.end, names) ||
        contains_reserved_linear_effect(stmt.step, names) ||
        contains_reserved_linear_stmt(stmt.body, names)
      ) {
        return true;
      }
    } else if (stmt.tag === "for_collection") {
      if (
        contains_reserved_linear_effect(stmt.collection, names) ||
        contains_reserved_linear_stmt(stmt.body, names)
      ) {
        return true;
      }
    } else if (stmt.tag === "if_stmt") {
      if (
        contains_reserved_linear_effect(stmt.cond, names) ||
        contains_reserved_linear_stmt(stmt.body, names)
      ) {
        return true;
      }
    } else if (stmt.tag === "if_let_stmt") {
      if (
        contains_reserved_linear_effect(stmt.target, names) ||
        contains_reserved_linear_stmt(stmt.body, names)
      ) {
        return true;
      }
    } else if (stmt.tag === "type_check") {
      if (contains_reserved_linear_effect(stmt.target, names)) {
        return true;
      }
    }
  }

  return false;
}

function uses_linear_name(expr: FrontExpr, names: Set<string>): boolean {
  switch (expr.tag) {
    case "var":
    case "linear":
      return names.has(expr.name);

    case "num":
    case "text":
    case "type_name":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return false;

    case "prim":
      return uses_linear_name(expr.left, names) ||
        uses_linear_name(expr.right, names);

    case "lam":
    case "rec":
      return false;

    case "app": {
      if (uses_linear_name(expr.func, names)) {
        return true;
      }

      for (const arg of expr.args) {
        if (uses_linear_name(arg, names)) {
          return true;
        }
      }

      return false;
    }

    case "block":
      for (const stmt of expr.statements) {
        if (stmt_uses_linear_name(stmt, names)) {
          return true;
        }
      }

      return false;

    case "comptime":
      return uses_linear_name(expr.expr, names);

    case "borrow":
      return uses_linear_name(expr.value, names);

    case "freeze":
      return uses_linear_name(expr.value, names);

    case "scratch":
      return uses_linear_name(expr.body, names);

    case "captured":
      return uses_linear_name(expr.expr, names);

    case "with": {
      if (uses_linear_name(expr.base, names)) {
        return true;
      }

      for (const field of expr.fields) {
        if (uses_linear_name(field.value, names)) {
          return true;
        }
      }

      return false;
    }

    case "struct_value": {
      if (uses_linear_name(expr.type_expr, names)) {
        return true;
      }

      for (const field of expr.fields) {
        if (uses_linear_name(field.value, names)) {
          return true;
        }
      }

      return false;
    }

    case "struct_update": {
      if (uses_linear_name(expr.base, names)) {
        return true;
      }

      for (const field of expr.fields) {
        if (uses_linear_name(field.value, names)) {
          return true;
        }
      }

      return false;
    }

    case "if":
      return uses_linear_name(expr.cond, names) ||
        uses_linear_name(expr.then_branch, names) ||
        uses_linear_name(expr.else_branch, names);

    case "if_let":
      return uses_linear_name(expr.target, names) ||
        uses_linear_name(expr.then_branch, names) ||
        uses_linear_name(expr.else_branch, names);

    case "field":
      return uses_linear_name(expr.object, names);

    case "index":
      return uses_linear_name(expr.object, names) ||
        uses_linear_name(expr.index, names);

    case "union_case":
      if (!expr.value) {
        return false;
      }

      return uses_linear_name(expr.value, names);
  }
}

function stmt_uses_linear_name(stmt: Stmt, names: Set<string>): boolean {
  if (stmt.tag === "bind") {
    return uses_linear_name(stmt.value, names);
  }

  if (stmt.tag === "assign") {
    return uses_linear_name(stmt.value, names);
  }

  if (stmt.tag === "index_assign") {
    return uses_linear_name(stmt.index, names) ||
      uses_linear_name(stmt.value, names);
  }

  if (stmt.tag === "return") {
    return uses_linear_name(stmt.value, names);
  }

  if (stmt.tag === "expr") {
    return uses_linear_name(stmt.expr, names);
  }

  if (stmt.tag === "for_range") {
    return uses_linear_name(stmt.start, names) ||
      uses_linear_name(stmt.end, names) ||
      uses_linear_name(stmt.step, names) ||
      stmts_use_linear_name(stmt.body, names);
  }

  if (stmt.tag === "for_collection") {
    return uses_linear_name(stmt.collection, names) ||
      stmts_use_linear_name(stmt.body, names);
  }

  if (stmt.tag === "if_stmt") {
    return uses_linear_name(stmt.cond, names) ||
      stmts_use_linear_name(stmt.body, names);
  }

  if (stmt.tag === "if_let_stmt") {
    return uses_linear_name(stmt.target, names) ||
      stmts_use_linear_name(stmt.body, names);
  }

  if (stmt.tag === "type_check") {
    return uses_linear_name(stmt.target, names);
  }

  return false;
}

function stmts_use_linear_name(stmts: Stmt[], names: Set<string>): boolean {
  for (const stmt of stmts) {
    if (stmt_uses_linear_name(stmt, names)) {
      return true;
    }
  }

  return false;
}
