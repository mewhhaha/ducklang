import { expect } from "../../expect.ts";
import type { CoreExpr } from "../ast.ts";
import type { DynamicUnionIf } from "../if_let.ts";
import { dynamic_if_let_can_match } from "../union_static.ts";
import { core_expr_definitely_exits } from "../expr_type/control.ts";
import type { CoreTextFactCtx, CoreTextFactHooks } from "./types.ts";

export function core_if_let_text_fact<ctx extends CoreTextFactCtx>(
  value: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: ctx,
  hooks: CoreTextFactHooks<ctx>,
  check_text: (
    value: CoreExpr,
    ctx: ctx,
    hooks: CoreTextFactHooks<ctx>,
  ) => boolean,
): boolean | undefined {
  const union_case = hooks.static_union_case(value.target, ctx);

  if (union_case) {
    return core_if_let_case_text_fact(
      value,
      union_case,
      ctx,
      hooks,
      check_text,
    );
  }

  const dynamic_target = hooks.dynamic_union_if(value.target, ctx);

  if (dynamic_target) {
    const cond_type = hooks.expr_type(dynamic_target.cond, ctx);
    expect(cond_type === "i32", "Core text if let condition must be i32");

    if (!dynamic_if_let_can_match(value.case_name, dynamic_target)) {
      if (value.implicit_else) {
        return false;
      }

      return check_text(value.else_branch, ctx, hooks);
    }

    let then_text = core_if_let_dynamic_case_text_fact(
      value,
      dynamic_target.then_case,
      dynamic_target,
      ctx,
      hooks,
      check_text,
    );
    let else_text = core_if_let_dynamic_case_text_fact(
      value,
      dynamic_target.else_case,
      dynamic_target,
      ctx,
      hooks,
      check_text,
    );

    if (
      value.implicit_else &&
      then_text &&
      !else_text &&
      dynamic_target.else_case.name !== value.case_name
    ) {
      else_text = true;
    }

    if (
      value.implicit_else &&
      else_text &&
      !then_text &&
      dynamic_target.then_case.name !== value.case_name
    ) {
      then_text = true;
    }

    return then_text && else_text;
  }

  const runtime_target = hooks.runtime_union_target(value.target, ctx);

  if (!runtime_target) {
    return undefined;
  }

  const info = hooks.runtime_union_match_info(
    value.case_name,
    runtime_target,
    ctx,
  );
  const branch_ctx = hooks.static_runtime_union_match_branch_ctx(
    value.value_name,
    info,
    ctx,
  );

  const then_text = check_text(value.then_branch, branch_ctx, hooks);

  if (value.implicit_else) {
    return then_text;
  }

  if (core_expr_definitely_exits(value.then_branch)) {
    return check_text(value.else_branch, ctx, hooks);
  }

  if (core_expr_definitely_exits(value.else_branch)) {
    return then_text;
  }

  return then_text && check_text(value.else_branch, ctx, hooks);
}

function core_if_let_dynamic_case_text_fact<ctx extends CoreTextFactCtx>(
  value: Extract<CoreExpr, { tag: "if_let" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  target: DynamicUnionIf,
  ctx: ctx,
  hooks: CoreTextFactHooks<ctx>,
  check_text: (
    value: CoreExpr,
    ctx: ctx,
    hooks: CoreTextFactHooks<ctx>,
  ) => boolean,
): boolean {
  if (union_case.name !== value.case_name) {
    if (value.implicit_else) {
      return false;
    }

    return check_text(value.else_branch, ctx, hooks);
  }

  const branch_ctx = hooks.if_let_branch_ctx(ctx);
  hooks.bind_dynamic_if_let_payload(
    value.case_name,
    value.value_name,
    target,
    branch_ctx,
  );
  return check_text(value.then_branch, branch_ctx, hooks);
}

function core_if_let_case_text_fact<ctx extends CoreTextFactCtx>(
  value: Extract<CoreExpr, { tag: "if_let" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  ctx: ctx,
  hooks: CoreTextFactHooks<ctx>,
  check_text: (
    value: CoreExpr,
    ctx: ctx,
    hooks: CoreTextFactHooks<ctx>,
  ) => boolean,
): boolean {
  if (union_case.name !== value.case_name) {
    if (value.implicit_else) {
      return false;
    }

    return check_text(value.else_branch, ctx, hooks);
  }

  const branch_ctx = hooks.if_let_branch_ctx(ctx);
  hooks.bind_core_if_let_payload_fact(
    value.value_name,
    union_case,
    branch_ctx,
  );

  const then_text = check_text(value.then_branch, branch_ctx, hooks);
  return then_text;
}
