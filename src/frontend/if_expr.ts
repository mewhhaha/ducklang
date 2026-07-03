import { expect } from "../expect.ts";
import { Ic, type Ic as IcNode } from "../ic.ts";
import type { Prim } from "../op.ts";
import type { Env, FrontExpr, FrontType } from "./ast.ts";
import { clone_env } from "./env.ts";
import {
  bind_function_if_params,
  function_if_param_types,
  resolve_direct_lambda,
} from "./function_if.ts";
import { lower_lambda_binding } from "./ic_share.ts";
import { select_prim_for_branches } from "./numeric.ts";
import { common_front_type, front_type_name } from "./types.ts";

export type IfExprHooks = {
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lower_dynamic_struct_if: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => IcNode | undefined;
  lower_dynamic_union_if: (
    expr: Extract<FrontExpr, { tag: "if" }>,
    env: Env,
  ) => IcNode | undefined;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  resolve_annotation_type: (
    annotation: string,
    env: Env,
  ) => FrontType | undefined;
};

export function lower_if_expr(
  expr: Extract<FrontExpr, { tag: "if" }>,
  env: Env,
  hooks: IfExprHooks,
): IcNode {
  check_if_condition(expr.cond, env, hooks);
  const cond = Ic.reduce(hooks.lower_expr(expr.cond, env));

  if (cond.tag === "num") {
    if (cond.type !== "i32") {
      throw new Error("If condition expects i32, got " + cond.type);
    }

    const value = cond.value;
    expect(typeof value === "number", "Expected i32 if condition");

    if (value !== 0) {
      return hooks.lower_expr(expr.then_branch, env);
    }

    if (expr.implicit_else) {
      const then_type = hooks.infer_expr(expr.then_branch, env);
      return lower_implicit_zero("if", then_type);
    }

    return hooks.lower_expr(expr.else_branch, env);
  }

  const then_type = hooks.infer_expr(expr.then_branch, env);
  const else_type = hooks.infer_expr(expr.else_branch, env);
  const branch_type = common_if_type(expr.implicit_else, then_type, else_type);

  if (!branch_type) {
    if (then_type.tag === "fn" && else_type.tag === "fn") {
      const fn_if = lower_dynamic_function_if(expr, cond, env, hooks);

      if (fn_if) {
        return fn_if;
      }
    }

    const union_if = hooks.lower_dynamic_union_if(expr, env);

    if (union_if) {
      return union_if;
    }

    throw new Error("If branches must have the same type");
  }

  const struct_if = hooks.lower_dynamic_struct_if(expr, env);

  if (struct_if) {
    return struct_if;
  }

  const union_if = hooks.lower_dynamic_union_if(expr, env);

  if (union_if) {
    return union_if;
  }

  if (branch_type.tag === "fn") {
    const fn_if = lower_dynamic_function_if(expr, cond, env, hooks);

    if (fn_if) {
      return fn_if;
    }
  }

  if (branch_type.tag === "text") {
    return {
      tag: "prim",
      prim: "i32.select",
      args: [
        hooks.lower_expr(expr.then_branch, env),
        lower_if_else_branch(expr, branch_type, env, hooks),
        cond,
      ],
    };
  }

  if (branch_type.tag !== "int") {
    throw new Error("Cannot lower dynamic if with non-i32 branches yet");
  }

  let select_prim: Prim = "i32.select";

  if (!expr.implicit_else) {
    select_prim = select_prim_for_branches(
      expr.then_branch,
      expr.else_branch,
    );
  }

  if (branch_type.type === "i64") {
    select_prim = "i64.select";
  }

  return {
    tag: "prim",
    prim: select_prim,
    args: [
      hooks.lower_expr(expr.then_branch, env),
      lower_if_else_branch(expr, branch_type, env, hooks),
      cond,
    ],
  };
}

function common_if_type(
  implicit_else: boolean | undefined,
  then_type: FrontType,
  else_type: FrontType,
): FrontType | undefined {
  const branch_type = common_front_type(then_type, else_type);

  if (branch_type) {
    return branch_type;
  }

  if (
    implicit_else &&
    (then_type.tag === "int" || then_type.tag === "text")
  ) {
    return then_type;
  }

  return undefined;
}

function lower_if_else_branch(
  expr: Extract<FrontExpr, { tag: "if" }>,
  branch_type: FrontType,
  env: Env,
  hooks: IfExprHooks,
): IcNode {
  if (expr.implicit_else) {
    return lower_implicit_zero("if", branch_type);
  }

  return hooks.lower_expr(expr.else_branch, env);
}

function lower_implicit_zero(label: string, type: FrontType): IcNode {
  if (type.tag === "text") {
    return { tag: "text", value: "" };
  }

  if (type.tag !== "int") {
    throw new Error(
      "Cannot lower no-else " + label + " with non-scalar branch yet",
    );
  }

  if (type.type === "i64") {
    return { tag: "num", type: "i64", value: 0n };
  }

  return { tag: "num", type: "i32", value: 0 };
}

function lower_dynamic_function_if(
  expr: Extract<FrontExpr, { tag: "if" }>,
  cond: IcNode,
  env: Env,
  hooks: IfExprHooks,
): IcNode | undefined {
  const then_lam = resolve_direct_lambda(expr.then_branch, env);
  const else_lam = resolve_direct_lambda(expr.else_branch, env);

  if (!then_lam || !else_lam) {
    return undefined;
  }

  const param_types = function_if_param_types(
    then_lam.expr.params,
    then_lam.env,
    else_lam.expr.params,
    else_lam.env,
    hooks,
  );

  if (!param_types) {
    throw new Error(
      "Dynamic function branches must have compatible parameters",
    );
  }

  const then_env = clone_env(then_lam.env);
  const else_env = clone_env(else_lam.env);
  const names = bind_function_if_params(
    then_lam.expr.params,
    then_env,
    else_lam.expr.params,
    else_env,
    param_types,
  );

  if (!names) {
    return undefined;
  }

  const then_type = hooks.infer_expr(then_lam.expr.body, then_env);
  const else_type = hooks.infer_expr(else_lam.expr.body, else_env);
  const branch_if: FrontExpr = {
    tag: "if",
    cond: { tag: "captured", expr: expr.cond, env },
    then_branch: {
      tag: "captured",
      expr: then_lam.expr.body,
      env: then_env,
    },
    else_branch: {
      tag: "captured",
      expr: else_lam.expr.body,
      env: else_env,
    },
  };
  let result_type = common_front_type(then_type, else_type);

  if (!result_type) {
    const branch_if_type = hooks.infer_expr(branch_if, env);

    if (branch_if_type.tag !== "union_value") {
      return undefined;
    }

    result_type = branch_if_type;
  }

  let body: IcNode | undefined;

  if (result_type.tag === "text") {
    body = {
      tag: "prim",
      prim: "i32.select",
      args: [
        hooks.lower_expr(then_lam.expr.body, then_env),
        hooks.lower_expr(else_lam.expr.body, else_env),
        cond,
      ],
    };
  } else if (result_type.tag === "int") {
    let select_prim: Prim = "i32.select";

    if (result_type.type === "i64") {
      select_prim = "i64.select";
    }

    body = {
      tag: "prim",
      prim: select_prim,
      args: [
        hooks.lower_expr(then_lam.expr.body, then_env),
        hooks.lower_expr(else_lam.expr.body, else_env),
        cond,
      ],
    };
  } else if (
    result_type.tag === "struct" || result_type.tag === "union" ||
    result_type.tag === "union_value"
  ) {
    body = hooks.lower_expr(branch_if, env);
  }

  if (!body) {
    return undefined;
  }

  for (let index = names.length - 1; index >= 0; index -= 1) {
    const name = names[index];
    expect(name, "Missing function-if parameter " + index.toString());
    body = lower_lambda_binding(name, body);
  }

  return body;
}

function check_if_condition(
  expr: FrontExpr,
  env: Env,
  hooks: Pick<IfExprHooks, "infer_expr">,
): void {
  const type = hooks.infer_expr(expr, env);

  if (type.tag === "unknown") {
    return;
  }

  if (type.tag === "int" && type.type !== "i64") {
    return;
  }

  throw new Error("If condition expects i32, got " + front_type_name(type));
}
