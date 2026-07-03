import { expect } from "../expect.ts";
import { Ic, type Ic as IcNode } from "../ic.ts";
import type { Env, FrontExpr } from "./ast.ts";
import { clone_env } from "./env.ts";
import { structured_core_route } from "./diagnostic.ts";
import {
  lower_app_expr,
  lower_field_expr,
  lower_index_expr,
} from "./expr_lower_access.ts";
import {
  lower_lam_expr,
  lower_linear_expr,
  lower_var_expr,
} from "./expr_lower_binding.ts";
import type { ExprLowerHooks } from "./expr_lower_types.ts";
import { front_expr_is_static_shareable_text } from "./ownership.ts";
import { validate_rec_tail } from "./rec.ts";
import { validate_const_expr } from "./constness.ts";

export type { ExprLowerHooks } from "./expr_lower_types.ts";

export function lower_expr(
  expr: FrontExpr,
  env: Env,
  hooks: ExprLowerHooks,
): IcNode {
  switch (expr.tag) {
    case "num":
      return { tag: "num", type: expr.type, value: expr.value };

    case "text":
      return { tag: "text", value: expr.value };

    case "type_name":
      throw new Error(
        "Cannot lower type value to Ic frontend yet: " + expr.name,
      );

    case "var":
      return lower_var_expr(expr, env, hooks, lower_expr);

    case "prim": {
      if (expr.prim === "i32.eq" || expr.prim === "i32.ne") {
        const left_type = hooks.infer_expr(expr.left, env);
        const right_type = hooks.infer_expr(expr.right, env);

        if (left_type.tag === "text" && right_type.tag === "text") {
          const left_text = hooks.visible_text_value(
            expr.left,
            env,
            new Set(),
          );
          const right_text = hooks.visible_text_value(
            expr.right,
            env,
            new Set(),
          );

          if (left_text && right_text) {
            const equality = lower_visible_text_equality(
              left_text,
              right_text,
              expr.prim === "i32.ne",
              env,
              hooks,
            );

            if (equality) {
              return equality;
            }
          }

          throw new Error(
            "Text equality with runtime text requires structured Core/Wasm lowering" +
              structured_core_route,
          );
        }
      }

      const text_value = hooks.visible_text_value(expr, env, new Set());

      if (text_value) {
        return lower_expr(text_value, env, hooks);
      }

      hooks.check_text_concat_operand_visibility(expr, env);
      const prim = hooks.check_numeric_primitive_operands(expr, env);
      return {
        tag: "prim",
        prim,
        args: [
          lower_expr(expr.left, env, hooks),
          lower_expr(expr.right, env, hooks),
        ],
      };
    }

    case "lam":
      return lower_lam_expr(expr, env, hooks, lower_expr);

    case "rec":
      validate_rec_tail(expr.body);
      throw new Error(
        "Cannot lower rec to Ic frontend yet" + structured_core_route,
      );

    case "app":
      return lower_app_expr(expr, env, hooks, lower_expr);

    case "block": {
      const local = clone_env(env);
      return hooks.lower_statements(expr.statements, 0, local);
    }

    case "comptime": {
      validate_const_expr(
        expr.expr,
        env,
        new Set(),
        "comptime expression requires compile-time values",
      );
      const value = lower_expr(expr.expr, env, hooks);
      return Ic.reduce(value);
    }

    case "borrow": {
      if (can_lower_ownership_wrapper_to_ic(expr.value, env, hooks)) {
        return lower_expr(expr.value, env, hooks);
      }

      throw new Error(
        "Cannot lower borrow view with non-scalar result to Ic frontend yet" +
          structured_core_route,
      );
    }

    case "freeze": {
      if (can_lower_ownership_wrapper_to_ic(expr.value, env, hooks)) {
        return lower_expr(expr.value, env, hooks);
      }

      throw new Error(
        "Cannot lower freeze value with non-scalar result to Ic frontend yet" +
          structured_core_route,
      );
    }

    case "scratch": {
      if (can_lower_ownership_wrapper_to_ic(expr.body, env, hooks)) {
        return lower_expr(expr.body, env, hooks);
      }

      throw new Error(
        "Cannot lower scratch block with non-scalar result to Ic frontend yet" +
          structured_core_route,
      );
    }

    case "captured":
      return lower_expr(expr.expr, expr.env, hooks);

    case "with":
      throw new Error("Cannot lower with extension to Ic frontend yet");

    case "struct_type":
      throw new Error("Cannot lower struct type to Ic frontend yet");

    case "struct_value":
      return hooks.lower_struct_value(expr, env);

    case "struct_update":
      return lower_expr(
        hooks.apply_struct_update(expr, env),
        env,
        hooks,
      );

    case "union_type":
      throw new Error("Cannot lower union type to Ic frontend yet");

    case "if":
      return hooks.lower_if_expr(expr, env);

    case "if_let":
      return hooks.lower_if_let(expr, env);

    case "field":
      return lower_field_expr(expr, env, hooks, lower_expr);

    case "index":
      return lower_index_expr(expr, env, hooks);

    case "union_case":
      return hooks.lower_union_case_value(expr, env);

    case "linear":
      return lower_linear_expr(expr, env, hooks, lower_expr);

    case "unsupported":
      throw new Error("Cannot lower " + expr.feature + " to Ic frontend yet");
  }
}

function can_lower_ownership_wrapper_to_ic(
  expr: FrontExpr,
  env: Env,
  hooks: ExprLowerHooks,
): boolean {
  const result_type = hooks.infer_expr(expr, env);

  if (result_type.tag === "int") {
    return true;
  }

  if (front_expr_is_static_shareable_text(expr, env, hooks)) {
    return true;
  }

  if (result_type.tag === "struct") {
    return true;
  }

  if (result_type.tag === "union" || result_type.tag === "union_value") {
    return true;
  }

  if (result_type.tag === "fn") {
    return true;
  }

  return false;
}

function lower_visible_text_equality(
  left: FrontExpr,
  right: FrontExpr,
  invert: boolean,
  env: Env,
  hooks: ExprLowerHooks,
): IcNode | undefined {
  if (left.tag === "text" && right.tag === "text") {
    let equal = left.value === right.value;

    if (invert) {
      equal = !equal;
    }

    let value = 0;

    if (equal) {
      value = 1;
    }

    return { tag: "num", type: "i32", value };
  }

  if (left.tag === "if") {
    const then_branch = lower_visible_text_equality(
      left.then_branch,
      right,
      invert,
      env,
      hooks,
    );
    const else_branch = lower_visible_text_equality(
      left.else_branch,
      right,
      invert,
      env,
      hooks,
    );

    if (!then_branch || !else_branch) {
      return undefined;
    }

    return lower_text_equality_branch(
      left.cond,
      then_branch,
      else_branch,
      env,
      hooks,
    );
  }

  if (right.tag === "if") {
    const then_branch = lower_visible_text_equality(
      left,
      right.then_branch,
      invert,
      env,
      hooks,
    );
    const else_branch = lower_visible_text_equality(
      left,
      right.else_branch,
      invert,
      env,
      hooks,
    );

    if (!then_branch || !else_branch) {
      return undefined;
    }

    return lower_text_equality_branch(
      right.cond,
      then_branch,
      else_branch,
      env,
      hooks,
    );
  }

  return undefined;
}

function lower_text_equality_branch(
  cond_expr: FrontExpr,
  then_branch: IcNode,
  else_branch: IcNode,
  env: Env,
  hooks: ExprLowerHooks,
): IcNode {
  const cond = Ic.reduce(lower_expr(cond_expr, env, hooks));

  if (cond.tag === "num") {
    expect(cond.type === "i32", "Text equality branch condition must be i32");
  }

  return {
    tag: "prim",
    prim: "i32.select",
    args: [then_branch, else_branch, cond],
  };
}
