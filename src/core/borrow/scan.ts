import { expect } from "../../expect.ts";
import type { CoreExpr, CoreField, CoreStmt } from "../ast.ts";
import { core_scratch_exit_edges } from "../cleanup.ts";
import {
  bind_if_let_payload_owner_alias,
  borrow_owner_names_with_aliases,
  clear_borrow_alias,
  clone_borrow_aliases,
} from "./aliases.ts";
import { check_borrowed_owner_barriers } from "./barrier.ts";
import {
  record_captured_borrow_views,
  record_stored_borrow_view_escape,
} from "./capture.ts";
import { core_expr_contains_borrow } from "./contains.ts";
import { add_scope } from "./scope.ts";
import { scan_borrow_stmts_with_expr } from "./stmt.ts";
import type {
  CoreBorrowAliases,
  CoreBorrowHooks,
  CoreBorrowState,
  CoreBorrowUse,
  CoreRecordedBorrow,
} from "./types.ts";
import { record_borrow_expr_with_scan } from "./record.ts";

function scan_borrow_expr<ctx>(
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
): void {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "var": {
      const view = aliases.views.get(expr.name);

      if (view) {
        if (use === "escaping") {
          record_stored_borrow_view_escape(
            expr.name,
            view,
            parent,
            state,
            "cannot escape",
          );
        }
        return;
      }

      const static_value = hooks.static_value(expr.name, ctx);

      if (static_value) {
        scan_borrow_expr(static_value, ctx, hooks, parent, state, use, aliases);
      }

      return;
    }

    case "lam":
    case "rec": {
      const scope = add_scope(state, "closure", undefined, parent);
      const closure_ctx = hooks.closure_body_ctx(expr, ctx);

      if (closure_ctx.tag === "skip") {
        if (core_expr_contains_borrow(expr.body, ctx, hooks, new Set())) {
          state.skipped_closures.push({
            scope: scope.id,
            reason: closure_ctx.reason,
          });
        }
        return;
      }

      const closure_aliases = clone_borrow_aliases(aliases);

      for (const param of expr.params) {
        clear_borrow_alias(param.name, closure_aliases);
        closure_aliases.known.add(param.name);
      }

      scan_borrow_expr(
        expr.body,
        closure_ctx.ctx,
        hooks,
        scope.id,
        state,
        "escaping",
        closure_aliases,
      );
      record_captured_borrow_views(expr.body, aliases, scope.id, state);
      return;
    }

    case "prim":
      for (const arg of expr.args) {
        scan_borrow_expr(arg, ctx, hooks, parent, state, "bounded", aliases);
      }
      return;

    case "app": {
      const scope = add_scope(state, "function_call", undefined, parent);
      const inlined = hooks.static_core_call_value(expr, ctx);

      if (inlined) {
        scan_borrow_expr(inlined, ctx, hooks, scope.id, state, use, aliases);
        return;
      }

      check_host_transfer_barriers(expr, ctx, hooks, scope.id, state, aliases);
      scan_borrow_expr(
        expr.func,
        ctx,
        hooks,
        scope.id,
        state,
        "bounded",
        aliases,
      );

      for (const arg of expr.args) {
        scan_borrow_expr(arg, ctx, hooks, scope.id, state, "bounded", aliases);
      }
      return;
    }

    case "block": {
      const scope = add_scope(state, "block", undefined, parent);
      scan_borrow_stmts(
        expr.statements,
        ctx,
        hooks,
        scope.id,
        state,
        use,
        clone_borrow_aliases(aliases),
      );
      return;
    }

    case "loop": {
      const scope = add_scope(state, "loop", undefined, parent);
      scan_borrow_stmts(
        expr.body,
        ctx,
        hooks,
        scope.id,
        state,
        use,
        aliases,
      );
      return;
    }

    case "comptime":
      scan_borrow_expr(expr.expr, ctx, hooks, parent, state, use, aliases);
      return;

    case "borrow": {
      record_borrow_expr(expr, ctx, hooks, parent, state, use, aliases);
      return;
    }

    case "freeze":
      check_borrowed_owner_barriers(
        borrow_owner_names_with_aliases(expr.value, aliases),
        "freeze",
        parent,
        state,
      );
      scan_borrow_expr(
        expr.value,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      return;

    case "scratch": {
      const scope = add_scope(
        state,
        "scratch",
        core_scratch_exit_edges(expr.body),
        parent,
      );
      scan_borrow_expr(expr.body, ctx, hooks, scope.id, state, use, aliases);
      return;
    }

    case "with":
      scan_borrow_expr(
        expr.base,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scan_borrow_fields(expr.fields, ctx, hooks, parent, state, use, aliases);
      return;

    case "struct_value":
      scan_borrow_expr(
        expr.type_expr,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scan_borrow_fields(expr.fields, ctx, hooks, parent, state, use, aliases);
      return;

    case "struct_update":
      scan_borrow_expr(
        expr.base,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scan_borrow_fields(expr.fields, ctx, hooks, parent, state, use, aliases);
      return;

    case "if":
      scan_borrow_expr(
        expr.cond,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scan_borrow_expr(
        expr.then_branch,
        ctx,
        hooks,
        parent,
        state,
        use,
        aliases,
      );
      scan_borrow_expr(
        expr.else_branch,
        ctx,
        hooks,
        parent,
        state,
        use,
        aliases,
      );
      return;

    case "if_let":
      scan_borrow_expr(
        expr.target,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      {
        const then_aliases = clone_borrow_aliases(aliases);

        if (expr.value_name) {
          bind_if_let_payload_owner_alias(
            expr.case_name,
            expr.value_name,
            expr.target,
            ctx,
            hooks,
            then_aliases,
          );
        }

        scan_borrow_expr(
          expr.then_branch,
          ctx,
          hooks,
          parent,
          state,
          use,
          then_aliases,
        );
      }
      scan_borrow_expr(
        expr.else_branch,
        ctx,
        hooks,
        parent,
        state,
        use,
        aliases,
      );
      return;

    case "field":
      scan_borrow_expr(
        expr.object,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      return;

    case "index":
      scan_borrow_expr(
        expr.object,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      scan_borrow_expr(
        expr.index,
        ctx,
        hooks,
        parent,
        state,
        "bounded",
        aliases,
      );
      return;

    case "union_case":
      if (expr.value) {
        scan_borrow_expr(expr.value, ctx, hooks, parent, state, use, aliases);
      }

      if (expr.type_expr) {
        scan_borrow_expr(
          expr.type_expr,
          ctx,
          hooks,
          parent,
          state,
          "bounded",
          aliases,
        );
      }
      return;
  }
}

export function scan_borrow_stmts<ctx>(
  statements: CoreStmt[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  final_use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
): void {
  scan_borrow_stmts_with_expr(
    statements,
    ctx,
    hooks,
    parent,
    state,
    final_use,
    aliases,
    scan_borrow_expr,
  );
}

function scan_borrow_fields<ctx>(
  fields: CoreField[],
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
): void {
  for (const field of fields) {
    scan_borrow_expr(field.value, ctx, hooks, parent, state, use, aliases);
  }
}

function check_host_transfer_barriers<ctx>(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  aliases: CoreBorrowAliases,
): void {
  if (!hooks.host_import_for_app) {
    return;
  }

  const host_import = hooks.host_import_for_app(expr, ctx);

  if (!host_import) {
    return;
  }

  for (let index = 0; index < host_import.args.length; index += 1) {
    const contract = host_import.args[index];
    expect(contract, "Missing host import argument contract");

    if (contract.tag !== "ownership_transfer") {
      continue;
    }

    const arg = expr.args[index];
    expect(arg, "Missing host import argument");
    check_borrowed_owner_barriers(
      borrow_owner_names_with_aliases(arg, aliases),
      "transfer",
      parent,
      state,
    );
  }
}

function record_borrow_expr<ctx>(
  expr: Extract<CoreExpr, { tag: "borrow" }>,
  ctx: ctx,
  hooks: CoreBorrowHooks<ctx>,
  parent: string,
  state: CoreBorrowState,
  use: CoreBorrowUse,
  aliases: CoreBorrowAliases,
): CoreRecordedBorrow {
  return record_borrow_expr_with_scan(
    expr,
    ctx,
    hooks,
    parent,
    state,
    use,
    aliases,
    scan_borrow_expr,
  );
}
