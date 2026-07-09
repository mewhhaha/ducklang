import type { CoreExpr } from "../ast.ts";
import type { DynamicUnionIf } from "../if_let.ts";
import { static_block_result } from "../type_static.ts";
import { dynamic_if_let_can_match } from "../union_static.ts";
import type {
  CoreOwnership,
  CoreOwnershipHooks,
  CoreOwnershipPointerReason,
} from "./types.ts";

type CoreOwnershipScanner<ctx> = (
  expr: CoreExpr,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
) => CoreOwnership;

export function core_if_branch_ownership<ctx>(
  expr: Extract<CoreExpr, { tag: "if" }>,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
  scan: CoreOwnershipScanner<ctx>,
): CoreOwnership | undefined {
  const then_ownership = scan(expr.then_branch, ctx, hooks);
  const else_ownership = scan(expr.else_branch, ctx, hooks);

  return merge_core_branch_ownership(then_ownership, else_ownership);
}

export function core_if_branches_are_freeze_results(
  expr: Extract<CoreExpr, { tag: "if" }>,
): boolean {
  return core_expr_result_is_freeze(expr.then_branch) &&
    core_expr_result_is_freeze(expr.else_branch);
}

export function core_expr_result_is_freeze(expr: CoreExpr): boolean {
  const block_value = static_block_result(expr);

  if (block_value) {
    return core_expr_result_is_freeze(block_value);
  }

  if (expr.tag === "freeze") {
    return true;
  }

  if (expr.tag === "if" && !expr.implicit_else) {
    return core_if_branches_are_freeze_results(expr);
  }

  if (expr.tag !== "block") {
    return false;
  }

  const final_stmt = expr.statements[expr.statements.length - 1];

  if (!final_stmt) {
    return false;
  }

  if (final_stmt.tag === "expr") {
    return core_expr_result_is_freeze(final_stmt.expr);
  }

  if (final_stmt.tag === "return") {
    return core_expr_result_is_freeze(final_stmt.value);
  }

  return false;
}

function merge_core_branch_ownership(
  left: CoreOwnership,
  right: CoreOwnership,
): CoreOwnership | undefined {
  switch (left.tag) {
    case "scalar_local":
      if (right.tag !== "scalar_local") {
        return undefined;
      }

      if (left.type !== right.type) {
        return undefined;
      }

      return left;

    case "unique_heap":
      if (right.tag !== "unique_heap") {
        return undefined;
      }

      if (left.reason !== right.reason) {
        return undefined;
      }

      return left;

    case "frozen_shareable":
      if (right.tag !== "frozen_shareable") {
        return undefined;
      }

      return {
        tag: "frozen_shareable",
        reason: merge_frozen_branch_reason(left.reason, right.reason),
      };

    case "borrow_view":
    case "scratch_backed":
      return undefined;
  }
}

function merge_frozen_branch_reason(
  left: CoreOwnershipPointerReason | "freeze",
  right: CoreOwnershipPointerReason | "freeze",
): CoreOwnershipPointerReason | "freeze" {
  if (left === right) {
    return left;
  }

  if (left === "text" && right === "text") {
    return "text";
  }

  return "freeze";
}

export function core_if_let_branch_ownership<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
  scan: CoreOwnershipScanner<ctx>,
): CoreOwnership | undefined {
  if (
    !hooks.if_let_branch_ctx ||
    !hooks.static_union_case ||
    !hooks.dynamic_union_if ||
    !hooks.bind_core_if_let_payload_fact ||
    !hooks.bind_dynamic_if_let_payload
  ) {
    return undefined;
  }

  const union_case = hooks.static_union_case(expr.target, ctx);

  if (union_case) {
    return core_if_let_case_ownership(expr, union_case, ctx, hooks, scan);
  }

  const dynamic_target = hooks.dynamic_union_if(expr.target, ctx);

  if (dynamic_target) {
    const cond_type = hooks.expr_type(dynamic_target.cond, ctx);

    if (cond_type !== "i32") {
      return undefined;
    }

    if (!dynamic_if_let_can_match(expr.case_name, dynamic_target)) {
      return scan(expr.else_branch, ctx, hooks);
    }

    const then_ownership = core_if_let_dynamic_case_ownership(
      expr,
      dynamic_target.then_case,
      dynamic_target,
      ctx,
      hooks,
      scan,
    );
    const else_ownership = core_if_let_dynamic_case_ownership(
      expr,
      dynamic_target.else_case,
      dynamic_target,
      ctx,
      hooks,
      scan,
    );

    return merge_core_branch_ownership(then_ownership, else_ownership);
  }

  if (
    !hooks.runtime_union_target ||
    !hooks.runtime_union_match_info ||
    !hooks.static_runtime_union_match_branch_ctx
  ) {
    return undefined;
  }

  const runtime_target = hooks.runtime_union_target(expr.target, ctx);

  if (!runtime_target) {
    return undefined;
  }

  const info = hooks.runtime_union_match_info(
    expr.case_name,
    runtime_target,
    ctx,
  );
  const branch_ctx = hooks.static_runtime_union_match_branch_ctx(
    expr.value_name,
    info,
    ctx,
  );
  const then_ownership = scan(expr.then_branch, branch_ctx, hooks);
  const else_ownership = scan(expr.else_branch, ctx, hooks);

  return merge_core_branch_ownership(then_ownership, else_ownership);
}

function core_if_let_dynamic_case_ownership<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  target: DynamicUnionIf,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
  scan: CoreOwnershipScanner<ctx>,
): CoreOwnership {
  if (union_case.name !== expr.case_name) {
    return scan(expr.else_branch, ctx, hooks);
  }

  const branch_ctx = hooks.if_let_branch_ctx!(ctx);
  hooks.bind_dynamic_if_let_payload!(
    expr.case_name,
    expr.value_name,
    target,
    branch_ctx,
  );
  return scan(expr.then_branch, branch_ctx, hooks);
}

function core_if_let_case_ownership<ctx>(
  expr: Extract<CoreExpr, { tag: "if_let" }>,
  union_case: Extract<CoreExpr, { tag: "union_case" }>,
  ctx: ctx,
  hooks: CoreOwnershipHooks<ctx>,
  scan: CoreOwnershipScanner<ctx>,
): CoreOwnership | undefined {
  if (union_case.name !== expr.case_name) {
    return scan(expr.else_branch, ctx, hooks);
  }

  const branch_ctx = hooks.if_let_branch_ctx!(ctx);
  hooks.bind_core_if_let_payload_fact!(
    expr.value_name,
    union_case,
    branch_ctx,
  );
  const then_ownership = scan(expr.then_branch, branch_ctx, hooks);
  const else_ownership = scan(expr.else_branch, ctx, hooks);

  return merge_core_branch_ownership(then_ownership, else_ownership);
}
