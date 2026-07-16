import type { CoreExpr, CoreField, CoreStmt } from "./ast.ts";

export function core_name_use_count(expr: CoreExpr, name: string): number {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "struct_type":
    case "union_type":
    case "rec_ref":
    case "unsupported":
      return 0;

    case "var":
    case "linear":
      if (expr.name === name) {
        return 1;
      }

      return 0;

    case "prim":
      return count_exprs(expr.args, name);

    case "lam":
    case "rec":
      if (expr.params.some((param) => param.name === name)) {
        return 0;
      }

      return core_name_use_count(expr.body, name);

    case "app":
      return core_name_use_count(expr.func, name) +
        count_exprs(expr.args, name);

    case "block":
      return count_statements(expr.statements, name);

    case "loop":
      return count_statements(expr.body, name);

    case "comptime":
      return core_name_use_count(expr.expr, name);

    case "borrow":
    case "freeze":
      return core_name_use_count(expr.value, name);

    case "scratch":
      return core_name_use_count(expr.body, name);

    case "with":
    case "struct_update":
      return core_name_use_count(expr.base, name) +
        count_fields(expr.fields, name);

    case "struct_value":
      return core_name_use_count(expr.type_expr, name) +
        count_fields(expr.fields, name);

    case "if":
      return core_name_use_count(expr.cond, name) +
        core_name_use_count(expr.then_branch, name) +
        core_name_use_count(expr.else_branch, name);

    case "if_let": {
      let then_count = 0;

      if (expr.value_name !== name) {
        then_count = core_name_use_count(expr.then_branch, name);
      }

      return core_name_use_count(expr.target, name) + then_count +
        core_name_use_count(expr.else_branch, name);
    }

    case "field":
      return core_name_use_count(expr.object, name);

    case "index":
      return core_name_use_count(expr.object, name) +
        core_name_use_count(expr.index, name);

    case "union_case": {
      let count = 0;

      if (expr.value !== undefined) {
        count += core_name_use_count(expr.value, name);
      }

      if (expr.type_expr !== undefined) {
        count += core_name_use_count(expr.type_expr, name);
      }

      return count;
    }
  }
}

function count_exprs(exprs: CoreExpr[], name: string): number {
  let count = 0;

  for (const expr of exprs) {
    count += core_name_use_count(expr, name);
  }

  return count;
}

function count_fields(fields: CoreField[], name: string): number {
  let count = 0;

  for (const field of fields) {
    count += core_name_use_count(field.value, name);
  }

  return count;
}

function count_statements(statements: CoreStmt[], name: string): number {
  let count = 0;
  let shadowed = false;

  for (const stmt of statements) {
    if (!shadowed) {
      count += count_statement(stmt, name);
    }

    if (stmt.tag === "bind" && stmt.name === name) {
      shadowed = true;
    }
  }

  return count;
}

function count_statement(stmt: CoreStmt, name: string): number {
  switch (stmt.tag) {
    case "continue":
    case "unsupported":
      return 0;

    case "bind":
    case "assign":
      return core_name_use_count(stmt.value, name);

    case "index_assign":
      return core_name_use_count(stmt.index, name) +
        core_name_use_count(stmt.value, name);

    case "range_loop": {
      let body = 0;

      if (stmt.index !== name) {
        body = count_statements(stmt.body, name);
      }

      return core_name_use_count(stmt.start, name) +
        core_name_use_count(stmt.end, name) +
        core_name_use_count(stmt.step, name) + body;
    }

    case "collection_loop": {
      let body = 0;

      if (stmt.index !== name && stmt.item !== name) {
        body = count_statements(stmt.body, name);
      }

      return core_name_use_count(stmt.collection, name) + body;
    }

    case "if_stmt":
      return core_name_use_count(stmt.cond, name) +
        count_statements(stmt.body, name);

    case "if_else_stmt":
      return core_name_use_count(stmt.cond, name) +
        count_statements(stmt.then_body, name) +
        count_statements(stmt.else_body, name);

    case "if_let_stmt": {
      let body = 0;

      if (stmt.value_name !== name) {
        body = count_statements(stmt.body, name);
      }

      return core_name_use_count(stmt.target, name) + body;
    }

    case "type_check":
      return core_name_use_count(stmt.target, name);

    case "break":
      if (stmt.value === undefined) {
        return 0;
      }

      return core_name_use_count(stmt.value, name);

    case "return":
      return core_name_use_count(stmt.value, name);

    case "expr":
      return core_name_use_count(stmt.expr, name);
  }
}
