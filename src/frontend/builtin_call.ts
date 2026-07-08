import type { Ic as IcNode } from "../ic.ts";
import type {
  Binding,
  Env,
  FrontExpr,
  FrontType,
  ResolvedFrontExpr,
  TypeField,
} from "./ast.ts";
import { call_message } from "./fields.ts";
import { lower_text_builtin_call } from "./builtin_call/text.ts";

export type BuiltinCallHooks = {
  capture_expr: (expr: FrontExpr, env: Env) => FrontExpr;
  eval_const_builtin: (
    expr: Extract<FrontExpr, { tag: "app" }>,
    env: Env,
  ) => FrontExpr | undefined;
  eval_simple_front_block: (
    expr: Extract<FrontExpr, { tag: "block" }>,
    env: Env,
  ) => FrontExpr | undefined;
  infer_expr: (expr: FrontExpr, env: Env) => FrontType;
  lookup: (env: Env, name: string) => Binding | undefined;
  lower_dynamic_index_access: (
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ) => IcNode | undefined;
  lower_expr: (expr: FrontExpr, env: Env) => IcNode;
  lower_runtime_struct_index_access: (
    object: FrontExpr,
    index: number,
    env: Env,
  ) => IcNode | undefined;
  lower_runtime_text_byte_index: (
    object: FrontExpr,
    index: FrontExpr,
    env: Env,
  ) => IcNode | undefined;
  lower_static_text_byte_index: (
    object: FrontExpr,
    index: number,
    env: Env,
  ) => IcNode | undefined;
  lower_text_len: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => IcNode | undefined;
  resolve_index_expr: (
    expr: Extract<FrontExpr, { tag: "index" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  resolve_runtime_struct_type: (
    expr: FrontExpr,
    env: Env,
  ) => { fields: TypeField[] } | undefined;
  resolve_static_i32_expr: (
    expr: FrontExpr,
    env: Env,
  ) => number | undefined;
  resolve_struct_field_expr: (
    expr: Extract<FrontExpr, { tag: "field" }>,
    env: Env,
  ) => ResolvedFrontExpr | undefined;
  visible_text_value: (
    expr: FrontExpr,
    env: Env,
    seen: Set<string>,
  ) => FrontExpr | undefined;
};

export function lower_builtin_call(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: BuiltinCallHooks,
): IcNode | undefined {
  if (expr.func.tag !== "var") {
    return undefined;
  }

  if (expr.func.name === "fail") {
    throw new Error("fail: " + call_message(expr.args));
  }

  if (expr.func.name === "panic") {
    call_message(expr.args);
    return { tag: "prim", prim: "i32.trap", args: [] };
  }

  const text_builtin = lower_text_builtin_call(expr, env, hooks);

  if (text_builtin) {
    return text_builtin;
  }

  const value = hooks.eval_const_builtin(expr, env);

  if (!value) {
    return undefined;
  }

  return hooks.lower_expr(value, env);
}

export function lower_method_app(
  expr: Extract<FrontExpr, { tag: "app" }>,
  env: Env,
  hooks: BuiltinCallHooks,
): IcNode | undefined {
  if (expr.func.tag !== "field") {
    return undefined;
  }

  if (expr.func.object.tag !== "var" && expr.func.object.tag !== "linear") {
    return undefined;
  }

  const receiver_binding = hooks.lookup(env, expr.func.object.name);

  if (
    !receiver_binding || receiver_binding.is_const ||
    receiver_binding.is_linear !== true
  ) {
    return undefined;
  }

  const method = hooks.resolve_struct_field_expr(expr.func, env);

  if (!method) {
    return undefined;
  }

  if (method.expr.tag !== "lam") {
    return undefined;
  }

  const receiver_name = expr.func.object.name;
  const args: FrontExpr[] = [{ tag: "linear", name: receiver_name }];

  for (const arg of expr.args) {
    args.push(arg);
  }

  return hooks.lower_expr(
    {
      tag: "app",
      func: hooks.capture_expr(method.expr, method.env),
      args,
    },
    env,
  );
}
