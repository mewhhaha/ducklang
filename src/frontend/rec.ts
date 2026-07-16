import { expect } from "../expect.ts";
import type { Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr, FrontType } from "./ast.ts";
import { structured_core_route } from "./diagnostic.ts";
import { validate_linear_rec } from "./linear.ts";
import { infer_rec_expr } from "./rec_infer.ts";
import { is_rec_call } from "./rec_validate.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import { bind_rec_args, resolve_rec_target } from "./rec_bind.ts";
import {
  lower_static_rec_block,
  type StaticRecExprLowerer,
} from "./rec_block.ts";
import {
  lower_rec_result_expr,
  type StaticRecBlockLowerer,
  type StaticRecResult,
} from "./rec_result.ts";
import { lower_expr_as_front_type } from "./typed_lower.ts";

export { validate_rec_tail } from "./rec_validate.ts";

export function infer_static_rec_app_type(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: StaticRecHooks,
): FrontType | undefined {
  const target = resolve_rec_target(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  const rec = target.expr;
  validate_static_rec_linear_params(rec);
  const call_args = static_rec_application_args(expr, rec.params.length);

  if (call_args.length !== rec.params.length) {
    throw new Error(
      "rec expected " + rec.params.length.toString() + " arguments, got " +
        call_args.length.toString(),
    );
  }

  const args = call_args.map((arg) => hooks.capture_expr(arg, env));
  const local = hooks.clone_env(target.env);
  bind_rec_args(rec, args, local, hooks);
  return infer_rec_expr(rec.body, local, hooks);
}

export function lower_static_rec_app(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: StaticRecHooks,
): IcNode | undefined {
  const target = resolve_rec_target(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  const rec = target.expr;
  validate_static_rec_linear_params(rec);
  const call_args = static_rec_application_args(expr, rec.params.length);

  if (call_args.length !== rec.params.length) {
    throw new Error(
      "rec expected " + rec.params.length.toString() + " arguments, got " +
        call_args.length.toString(),
    );
  }

  let args = call_args.map((arg) => hooks.capture_expr(arg, env));

  for (let step = 0; step < 10000; step += 1) {
    const local = hooks.clone_env(target.env);
    bind_rec_args(rec, args, local, hooks);
    const result = lower_static_rec_expr(
      rec.body,
      local,
      hooks,
      rec.params.length,
    );

    if (!result) {
      throw new Error(
        "Cannot lower rec body without result to Ic frontend yet" +
          structured_core_route,
      );
    }

    if (result.tag === "done") {
      return result.value;
    }

    args = result.args;
  }

  throw new Error("rec static lowering exceeded 10000 steps");
}

export function lower_static_rec_app_as_front_type(
  expr: Extract<FrontExpr, { tag: "app" }>,
  type: FrontType,
  env: Env,
  hooks: StaticRecHooks,
): IcNode | undefined {
  const target = resolve_rec_target(expr.func, env, hooks);

  if (!target) {
    return undefined;
  }

  const rec = target.expr;
  validate_static_rec_linear_params(rec);
  const call_args = static_rec_application_args(expr, rec.params.length);

  if (call_args.length !== rec.params.length) {
    throw new Error(
      "rec expected " + rec.params.length.toString() + " arguments, got " +
        call_args.length.toString(),
    );
  }

  let args = call_args.map((arg) => hooks.capture_expr(arg, env));

  for (let step = 0; step < 10000; step += 1) {
    const local = hooks.clone_env(target.env);
    bind_rec_args(rec, args, local, hooks);
    const result = lower_static_rec_expr(
      rec.body,
      local,
      hooks,
      rec.params.length,
      type,
    );

    if (!result) {
      throw new Error(
        "Cannot lower rec body without result to Ic frontend yet" +
          structured_core_route,
      );
    }

    if (result.tag === "done") {
      return result.value;
    }

    args = result.args;
  }

  throw new Error("rec static lowering exceeded 10000 steps");
}

function validate_static_rec_linear_params(
  rec: Extract<FrontExpr, { tag: "rec" }>,
): void {
  for (const param of rec.params) {
    if (param.is_linear) {
      validate_linear_rec(rec);
      return;
    }
  }
}

function lower_static_rec_expr(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  parameter_count: number,
  expected_type?: FrontType,
): StaticRecResult | undefined {
  const lower_expr: StaticRecExprLowerer = (
    nested_expr,
    block_env,
    block_hooks,
    block_expected_type,
  ) => {
    return lower_static_rec_expr(
      nested_expr,
      block_env,
      block_hooks,
      parameter_count,
      block_expected_type,
    );
  };
  const block_lowerer: StaticRecBlockLowerer = (
    stmts,
    block_env,
    block_hooks,
    block_expected_type,
  ) =>
    lower_static_rec_block(
      stmts,
      block_env,
      block_hooks,
      lower_expr,
      lower_rec_result_expr_with_expected_type,
      block_expected_type,
    );

  if (expr.tag === "captured") {
    return lower_static_rec_expr(
      expr.expr,
      expr.env,
      hooks,
      parameter_count,
      expected_type,
    );
  }

  if (expr.tag === "block") {
    return block_lowerer(expr.statements, env, hooks, expected_type);
  }

  if (expr.tag === "if") {
    const cond = hooks.resolve_static_i32_expr(expr.cond, env);

    if (cond === undefined) {
      return {
        tag: "done",
        value: lower_rec_result_expr_with_expected_type(
          expr,
          env,
          hooks,
          block_lowerer,
          expected_type,
        ),
      };
    }

    if (cond !== 0) {
      return lower_static_rec_expr(
        expr.then_branch,
        env,
        hooks,
        parameter_count,
        expected_type,
      );
    }

    return lower_static_rec_expr(
      expr.else_branch,
      env,
      hooks,
      parameter_count,
      expected_type,
    );
  }

  if (is_rec_call(expr)) {
    expect(expr.tag === "app", "Expected rec call");
    const args = static_rec_application_args(expr, parameter_count);

    return {
      tag: "call",
      args: args.map((arg) => hooks.capture_expr(arg, env)),
    };
  }

  return {
    tag: "done",
    value: lower_rec_result_expr_with_expected_type(
      expr,
      env,
      hooks,
      block_lowerer,
      expected_type,
    ),
  };
}

function static_rec_application_args(
  expr: Extract<FrontExpr, { tag: "app" }>,
  parameter_count: number,
): FrontExpr[] {
  if (expr.args.length === parameter_count) {
    return expr.args;
  }

  if (
    parameter_count === 1 && expr.arg !== undefined &&
    expr.arg.tag === "product"
  ) {
    return [expr.arg];
  }

  return expr.args;
}

function lower_rec_result_expr_with_expected_type(
  expr: FrontExpr,
  env: Env,
  hooks: StaticRecHooks,
  lower_static_rec_block: StaticRecBlockLowerer,
  expected_type?: FrontType,
): IcNode {
  if (!expected_type) {
    return lower_rec_result_expr(expr, env, hooks, lower_static_rec_block);
  }

  return lower_expr_as_front_type(expr, expected_type, env, {
    infer_expr: (value, value_env) => infer_rec_expr(value, value_env, hooks),
    lower_app_as_front_type: (value, type, value_env) =>
      lower_static_rec_app_as_front_type(value, type, value_env, hooks),
    lower_expr: (value, value_env) =>
      lower_rec_result_expr(value, value_env, hooks, lower_static_rec_block),
    resolve_annotation_type: hooks.resolve_annotation_type,
  });
}
