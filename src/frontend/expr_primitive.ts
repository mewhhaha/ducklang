import { expect } from "../expect.ts";
import { Ic, type Ic as IcNode } from "../ic.ts";
import type { NumType, Prim } from "../op.ts";
import type { Binding, Env, FrontExpr, Stmt } from "./ast.ts";
import { stmt_result_expr } from "./block_result.ts";
import { structured_core_route } from "./diagnostic.ts";
import { clone_env, fresh, lookup, push_binding } from "./env.ts";
import type { ExprLowerHooks, LowerExprFn } from "./expr_lower_types.ts";
import { unwrap_ownership_wrapper_expr } from "./ownership.ts";
import { lower_expr_as_front_type } from "./typed_lower.ts";

export function lower_prim_expr(
  expr: Extract<FrontExpr, { tag: "prim" }>,
  env: Env,
  hooks: ExprLowerHooks,
  lower_expr: LowerExprFn,
): IcNode {
  if (expr.prim === "i32.eq" || expr.prim === "i32.ne") {
    const left_type = hooks.infer_expr(expr.left, env);
    const right_type = hooks.infer_expr(expr.right, env);

    if (left_type.tag === "text" && right_type.tag === "text") {
      const identity = lower_text_identity_equality(expr, env, hooks);

      if (identity) {
        return identity;
      }

      const left_text = hooks.visible_text_value(expr.left, env, new Set());
      const right_text = hooks.visible_text_value(expr.right, env, new Set());

      if (left_text && right_text) {
        const equality = lower_visible_text_equality(
          left_text,
          right_text,
          expr.prim === "i32.ne",
          env,
          hooks,
          lower_expr,
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
      lower_numeric_primitive_operand(expr.left, prim, env, hooks, lower_expr),
      lower_numeric_primitive_operand(expr.right, prim, env, hooks, lower_expr),
    ],
  };
}

function lower_text_identity_equality(
  expr: Extract<FrontExpr, { tag: "prim" }>,
  env: Env,
  hooks: ExprLowerHooks,
): IcNode | undefined {
  const left_key = text_identity_key(expr.left, env, hooks, new Set());

  if (!left_key) {
    return undefined;
  }

  const right_key = text_identity_key(expr.right, env, hooks, new Set());

  if (!right_key) {
    return undefined;
  }

  if (left_key !== right_key) {
    return undefined;
  }

  if (expr.prim === "i32.ne") {
    return { tag: "num", type: "i32", value: 0 };
  }

  return { tag: "num", type: "i32", value: 1 };
}

function text_identity_key(
  expr: FrontExpr,
  env: Env,
  hooks: ExprLowerHooks,
  inline_bindings: Set<Binding>,
): string | undefined {
  let current = expr;
  let current_env = env;

  while (
    current.tag === "captured" ||
    current.tag === "borrow" ||
    current.tag === "freeze" ||
    current.tag === "scratch"
  ) {
    if (current.tag === "captured") {
      current_env = current.env;
      current = current.expr;
      continue;
    }

    if (current.tag === "scratch") {
      current = current.body;
      continue;
    }

    current = current.value;
  }

  if (current.tag === "block") {
    return text_identity_block_key(
      current.statements,
      current_env,
      hooks,
      inline_bindings,
    );
  }

  if (current.tag === "app") {
    const inlined = hooks.inline_runtime_call_expr(current, current_env);

    if (!inlined) {
      return undefined;
    }

    return text_identity_key(
      inlined.expr,
      inlined.env,
      hooks,
      inline_bindings,
    );
  }

  if (current.tag !== "var") {
    return undefined;
  }

  const binding = lookup(current_env, current.name);

  if (!binding) {
    return current.name;
  }

  if (inline_bindings.has(binding) && binding.value && !binding.is_linear) {
    let value_env = current_env;

    if (binding.value_env) {
      value_env = binding.value_env;
    }

    return text_identity_key(binding.value, value_env, hooks, inline_bindings);
  }

  return binding.ic_name;
}

function text_identity_block_key(
  stmts: Stmt[],
  env: Env,
  hooks: ExprLowerHooks,
  inline_bindings: Set<Binding>,
): string | undefined {
  if (stmts.length === 0) {
    return undefined;
  }

  const local = clone_env(env);
  const last_index = stmts.length - 1;

  for (let index = 0; index < last_index; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing text identity block statement " + index);

    if (stmt.tag !== "bind") {
      return undefined;
    }

    if (stmt.kind !== "let" || stmt.is_linear) {
      return undefined;
    }

    const binding: Binding = {
      name: stmt.name,
      ic_name: fresh(local, stmt.name),
      type: { tag: "unknown" },
      is_const: false,
      is_linear: false,
      value: stmt.value,
      value_env: clone_env(local),
    };
    push_binding(local, binding);
    inline_bindings.add(binding);
  }

  const result = stmts[last_index];
  expect(result, "Missing text identity block result");
  const result_expr = stmt_result_expr(result);

  if (!result_expr) {
    return undefined;
  }

  return text_identity_key(result_expr, local, hooks, inline_bindings);
}

function lower_numeric_primitive_operand(
  expr: FrontExpr,
  prim: Prim,
  env: Env,
  hooks: ExprLowerHooks,
  lower_expr: LowerExprFn,
): IcNode {
  return lower_expr_as_front_type(
    unwrap_ownership_wrapper_expr(expr),
    { tag: "int", type: numeric_primitive_operand_type(prim) },
    env,
    {
      infer_expr: hooks.infer_expr,
      lower_app_as_front_type: hooks.lower_app_as_front_type,
      lower_expr: (value, value_env) => lower_expr(value, value_env, hooks),
      resolve_annotation_type: hooks.resolve_annotation_type,
    },
  );
}

function numeric_primitive_operand_type(prim: Prim): NumType {
  if (prim.startsWith("i64.")) {
    return "i64";
  }

  if (prim.startsWith("f32.")) {
    return "f32";
  }

  return "i32";
}

function lower_visible_text_equality(
  left: FrontExpr,
  right: FrontExpr,
  invert: boolean,
  env: Env,
  hooks: ExprLowerHooks,
  lower_expr: LowerExprFn,
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
      lower_expr,
    );
    const else_branch = lower_visible_text_equality(
      left.else_branch,
      right,
      invert,
      env,
      hooks,
      lower_expr,
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
      lower_expr,
    );
  }

  if (right.tag === "if") {
    const then_branch = lower_visible_text_equality(
      left,
      right.then_branch,
      invert,
      env,
      hooks,
      lower_expr,
    );
    const else_branch = lower_visible_text_equality(
      left,
      right.else_branch,
      invert,
      env,
      hooks,
      lower_expr,
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
      lower_expr,
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
  lower_expr: LowerExprFn,
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
