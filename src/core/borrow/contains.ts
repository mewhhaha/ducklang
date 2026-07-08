import type { CoreExpr, CoreField, CoreStmt } from "../ast.ts";
import type { CoreBorrowHooks } from "./types.ts";

export function core_expr_contains_borrow<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  seen_static_names: Set<string>,
): boolean {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return false;

    case "borrow":
      return true;

    case "var": {
      if (seen_static_names.has(expr.name)) {
        return false;
      }

      const static_value = hooks.static_value(expr.name, ctx);

      if (!static_value) {
        return false;
      }

      seen_static_names.add(expr.name);
      return core_expr_contains_borrow(
        static_value,
        ctx,
        hooks,
        seen_static_names,
      );
    }

    case "lam":
    case "rec":
      return core_expr_contains_borrow(
        expr.body,
        ctx,
        hooks,
        seen_static_names,
      );

    case "prim":
      return core_exprs_contain_borrow(
        expr.args,
        ctx,
        hooks,
        seen_static_names,
      );

    case "app": {
      const inlined = hooks.static_core_call_value(expr, ctx);

      if (inlined) {
        return core_expr_contains_borrow(
          inlined,
          ctx,
          hooks,
          seen_static_names,
        );
      }

      if (
        core_expr_contains_borrow(expr.func, ctx, hooks, seen_static_names)
      ) {
        return true;
      }

      return core_exprs_contain_borrow(
        expr.args,
        ctx,
        hooks,
        seen_static_names,
      );
    }

    case "block":
      return core_stmts_contain_borrow(
        expr.statements,
        ctx,
        hooks,
        seen_static_names,
      );

    case "comptime":
      return core_expr_contains_borrow(
        expr.expr,
        ctx,
        hooks,
        seen_static_names,
      );

    case "freeze":
      return core_expr_contains_borrow(
        expr.value,
        ctx,
        hooks,
        seen_static_names,
      );

    case "scratch":
      return core_expr_contains_borrow(
        expr.body,
        ctx,
        hooks,
        seen_static_names,
      );

    case "with":
      if (core_expr_contains_borrow(expr.base, ctx, hooks, seen_static_names)) {
        return true;
      }

      return core_fields_contain_borrow(
        expr.fields,
        ctx,
        hooks,
        seen_static_names,
      );

    case "struct_value":
      if (
        core_expr_contains_borrow(
          expr.type_expr,
          ctx,
          hooks,
          seen_static_names,
        )
      ) {
        return true;
      }

      return core_fields_contain_borrow(
        expr.fields,
        ctx,
        hooks,
        seen_static_names,
      );

    case "struct_update":
      if (core_expr_contains_borrow(expr.base, ctx, hooks, seen_static_names)) {
        return true;
      }

      return core_fields_contain_borrow(
        expr.fields,
        ctx,
        hooks,
        seen_static_names,
      );

    case "if":
      return core_expr_contains_borrow(
        expr.cond,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_expr_contains_borrow(
          expr.then_branch,
          ctx,
          hooks,
          seen_static_names,
        ) ||
        core_expr_contains_borrow(
          expr.else_branch,
          ctx,
          hooks,
          seen_static_names,
        );

    case "if_let":
      return core_expr_contains_borrow(
        expr.target,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_expr_contains_borrow(
          expr.then_branch,
          ctx,
          hooks,
          seen_static_names,
        ) ||
        core_expr_contains_borrow(
          expr.else_branch,
          ctx,
          hooks,
          seen_static_names,
        );

    case "field":
      return core_expr_contains_borrow(
        expr.object,
        ctx,
        hooks,
        seen_static_names,
      );

    case "index":
      return core_expr_contains_borrow(
        expr.object,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_expr_contains_borrow(
          expr.index,
          ctx,
          hooks,
          seen_static_names,
        );

    case "union_case":
      if (
        expr.value &&
        core_expr_contains_borrow(expr.value, ctx, hooks, seen_static_names)
      ) {
        return true;
      }

      if (
        expr.type_expr &&
        core_expr_contains_borrow(
          expr.type_expr,
          ctx,
          hooks,
          seen_static_names,
        )
      ) {
        return true;
      }

      return false;
  }
}

function core_exprs_contain_borrow<ctx>(
  exprs: CoreExpr[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  seen_static_names: Set<string>,
): boolean {
  for (const expr of exprs) {
    if (core_expr_contains_borrow(expr, ctx, hooks, seen_static_names)) {
      return true;
    }
  }

  return false;
}

function core_fields_contain_borrow<ctx>(
  fields: CoreField[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  seen_static_names: Set<string>,
): boolean {
  for (const field of fields) {
    if (
      core_expr_contains_borrow(field.value, ctx, hooks, seen_static_names)
    ) {
      return true;
    }
  }

  return false;
}

function core_stmts_contain_borrow<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  seen_static_names: Set<string>,
): boolean {
  for (const stmt of statements) {
    if (core_stmt_contains_borrow(stmt, ctx, hooks, seen_static_names)) {
      return true;
    }
  }

  return false;
}

function core_stmt_contains_borrow<ctx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  seen_static_names: Set<string>,
): boolean {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      return core_expr_contains_borrow(
        stmt.value,
        ctx,
        hooks,
        seen_static_names,
      );

    case "index_assign":
      return core_expr_contains_borrow(
        stmt.index,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_expr_contains_borrow(
          stmt.value,
          ctx,
          hooks,
          seen_static_names,
        );

    case "range_loop":
      return core_expr_contains_borrow(
        stmt.start,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_expr_contains_borrow(
          stmt.end,
          ctx,
          hooks,
          seen_static_names,
        ) ||
        core_expr_contains_borrow(
          stmt.step,
          ctx,
          hooks,
          seen_static_names,
        ) ||
        core_stmts_contain_borrow(
          stmt.body,
          ctx,
          hooks,
          seen_static_names,
        );

    case "collection_loop":
      return core_expr_contains_borrow(
        stmt.collection,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_stmts_contain_borrow(
          stmt.body,
          ctx,
          hooks,
          seen_static_names,
        );

    case "if_stmt":
      return core_expr_contains_borrow(
        stmt.cond,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_stmts_contain_borrow(
          stmt.body,
          ctx,
          hooks,
          seen_static_names,
        );

    case "if_else_stmt":
      return core_expr_contains_borrow(
        stmt.cond,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_stmts_contain_borrow(
          stmt.then_body,
          ctx,
          hooks,
          seen_static_names,
        ) ||
        core_stmts_contain_borrow(
          stmt.else_body,
          ctx,
          hooks,
          seen_static_names,
        );

    case "if_let_stmt":
      return core_expr_contains_borrow(
        stmt.target,
        ctx,
        hooks,
        seen_static_names,
      ) ||
        core_stmts_contain_borrow(
          stmt.body,
          ctx,
          hooks,
          seen_static_names,
        );

    case "type_check":
      return core_expr_contains_borrow(
        stmt.target,
        ctx,
        hooks,
        seen_static_names,
      );

    case "return":
      return core_expr_contains_borrow(
        stmt.value,
        ctx,
        hooks,
        seen_static_names,
      );

    case "expr":
      return core_expr_contains_borrow(
        stmt.expr,
        ctx,
        hooks,
        seen_static_names,
      );

    case "break":
    case "continue":
    case "unsupported":
      return false;
  }
}
