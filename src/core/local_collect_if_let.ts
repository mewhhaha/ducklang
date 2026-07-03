import type { CoreExpr, CoreStmt } from "./ast.ts";
import { fresh_temp_local, set_local } from "./backend/util.ts";
import { clone_core_host_imports } from "./host_import.ts";
import type { DynamicUnionIf } from "./if_let.ts";
import type { CoreCtx, CoreLocalCollectHooks } from "./local_collect/types.ts";
import {
  runtime_union_match_info,
  type RuntimeUnionTarget,
} from "./runtime_union.ts";
import { core_runtime_union_match_branch_ctx } from "./runtime_union_match.ts";
import { dynamic_if_let_can_match } from "./union_static.ts";

export type CoreIfLetLocalCollectApi = {
  collect_expr_locals: (
    expr: CoreExpr,
    ctx: CoreCtx,
    hooks: CoreLocalCollectHooks,
  ) => void;
  collect_stmt_locals: (
    stmt: CoreStmt,
    ctx: CoreCtx,
    hooks: CoreLocalCollectHooks,
  ) => void;
};

export function collect_core_if_let_stmt_locals(
  stmt: Extract<CoreStmt, { tag: "if_let_stmt" }>,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreIfLetLocalCollectApi,
): void {
  const union_case = hooks.static_union_case(stmt.target, ctx);

  if (union_case) {
    if (union_case.name !== stmt.case_name) {
      return;
    }

    hooks.bind_core_if_let_payload_fact(
      stmt.value_name,
      union_case,
      ctx,
    );

    for (const item of stmt.body) {
      api.collect_stmt_locals(item, ctx, hooks);
    }

    return;
  }

  const dynamic_target = hooks.dynamic_union_if(stmt.target, ctx);

  if (dynamic_target) {
    hooks.expr_type(dynamic_target.cond, ctx);

    if (!dynamic_if_let_can_match(stmt.case_name, dynamic_target)) {
      return;
    }

    hooks.bind_dynamic_if_let_payload(
      stmt.case_name,
      stmt.value_name,
      dynamic_target,
      ctx,
    );
    hooks.clear_optional_core_union_local(stmt.value_name, ctx);

    for (const item of stmt.body) {
      api.collect_stmt_locals(item, ctx, hooks);
    }

    return;
  }

  const runtime_target = hooks.runtime_union_target(stmt.target, ctx);

  if (!runtime_target) {
    return;
  }

  collect_runtime_if_let_target_locals(runtime_target, ctx, hooks, api);
  const info = runtime_union_match_info(
    stmt.case_name,
    runtime_target,
    ctx,
  );
  const branch_ctx = core_runtime_union_match_branch_ctx(
    stmt.value_name,
    info,
    ctx,
  );

  for (const item of stmt.body) {
    api.collect_stmt_locals(item, branch_ctx, hooks);
  }

  ctx.next_loop = branch_ctx.next_loop;
  ctx.next_temp = branch_ctx.next_temp;
}

export function collect_core_if_let_expr_locals(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreIfLetLocalCollectApi,
): void {
  const union_case = hooks.static_union_case(expr.target, ctx);

  if (union_case) {
    if (union_case.name === expr.case_name) {
      const then_ctx = create_if_let_branch_ctx(ctx);

      collect_union_case_payload_locals(union_case, then_ctx, hooks, api);
      hooks.bind_core_if_let_payload_fact(
        expr.value_name,
        union_case,
        then_ctx,
      );

      api.collect_expr_locals(expr.then_branch, then_ctx, hooks);
      ctx.next_loop = then_ctx.next_loop;
      ctx.next_temp = then_ctx.next_temp;
    }

    api.collect_expr_locals(expr.else_branch, ctx, hooks);
    return;
  }

  const dynamic_target = hooks.dynamic_union_if(expr.target, ctx);

  if (dynamic_target) {
    api.collect_expr_locals(dynamic_target.cond, ctx, hooks);
    collect_dynamic_if_let_expr_case_locals(
      expr,
      dynamic_target.then_case,
      dynamic_target,
      ctx,
      hooks,
      api,
    );
    collect_dynamic_if_let_expr_case_locals(
      expr,
      dynamic_target.else_case,
      dynamic_target,
      ctx,
      hooks,
      api,
    );
    return;
  }

  const runtime_target = hooks.runtime_union_target(expr.target, ctx);

  if (!runtime_target) {
    api.collect_expr_locals(expr.target, ctx, hooks);
    api.collect_expr_locals(expr.then_branch, ctx, hooks);
    api.collect_expr_locals(expr.else_branch, ctx, hooks);
    return;
  }

  collect_runtime_if_let_target_locals(runtime_target, ctx, hooks, api);

  const info = runtime_union_match_info(expr.case_name, runtime_target, ctx);
  const branch_ctx = core_runtime_union_match_branch_ctx(
    expr.value_name,
    info,
    ctx,
  );

  api.collect_expr_locals(expr.then_branch, branch_ctx, hooks);
  ctx.next_loop = branch_ctx.next_loop;
  ctx.next_temp = branch_ctx.next_temp;

  if (!expr.implicit_else) {
    api.collect_expr_locals(expr.else_branch, ctx, hooks);
  }
}

function collect_dynamic_if_let_expr_case_locals(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  dynamic_target: DynamicUnionIf,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreIfLetLocalCollectApi,
): void {
  if (union_case.name !== expr.case_name) {
    if (expr.implicit_else) {
      return;
    }

    api.collect_expr_locals(expr.else_branch, ctx, hooks);
    return;
  }

  const branch_ctx = create_if_let_branch_ctx(ctx);

  collect_union_case_payload_locals(union_case, branch_ctx, hooks, api);
  hooks.bind_dynamic_if_let_payload(
    expr.case_name,
    expr.value_name,
    dynamic_target,
    branch_ctx,
  );
  api.collect_expr_locals(expr.then_branch, branch_ctx, hooks);
  ctx.next_loop = branch_ctx.next_loop;
  ctx.next_temp = branch_ctx.next_temp;
}

function collect_union_case_payload_locals(
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreIfLetLocalCollectApi,
): void {
  if (union_case.value) {
    api.collect_expr_locals(union_case.value, ctx, hooks);
  }

  if (union_case.type_expr) {
    api.collect_expr_locals(union_case.type_expr, ctx, hooks);
  }
}

function collect_runtime_if_let_target_locals(
  runtime_target: RuntimeUnionTarget,
  ctx: CoreCtx,
  hooks: CoreLocalCollectHooks,
  api: CoreIfLetLocalCollectApi,
): void {
  api.collect_expr_locals(runtime_target.target, ctx, hooks);
  const name = fresh_temp_local(ctx, "union_match");
  set_local(ctx.locals, name, "i32");
}

function create_if_let_branch_ctx(ctx: CoreCtx): CoreCtx {
  return {
    locals: ctx.locals,
    statics: new Map(ctx.statics),
    fn_types: new Map(ctx.fn_types),
    text_locals: new Set(ctx.text_locals),
    struct_locals: new Map(ctx.struct_locals),
    union_locals: new Map(ctx.union_locals),
    frozen_locals: clone_optional_set(ctx.frozen_locals),
    host_imports: clone_core_host_imports(ctx.host_imports),
    scratch_depth: ctx.scratch_depth,
    next_loop: ctx.next_loop,
    next_temp: ctx.next_temp,
  };
}

function clone_optional_set(
  value: Set<string> | undefined,
): Set<string> | undefined {
  if (!value) {
    return undefined;
  }

  return new Set(value);
}
