import { expect } from "../../../expect.ts";
import { type FuncParam } from "../../../mod.ts";
import { Prim, type ValType } from "../../../op.ts";
import { Callable } from "../../../trait.ts";
import type { Ic } from "../../ast.ts";
import { collect_app, is_memory_prim } from "./shared.ts";
import type {
  FuncInfo,
  RecursiveInferCtx,
  RecursiveOpenTerm,
} from "./types.ts";

export function infer_recursive_open_term(
  ic: Extract<Ic, { tag: "fix" }>,
  name: string,
  explicit_params: Record<string, ValType> | undefined,
): RecursiveOpenTerm {
  const func = lambda_info(ic.name, ic.expr);

  if (func.name === name) {
    throw new Error(
      "Recursive Ic function name conflicts with exported function: " + name,
    );
  }

  const funcs = new Map<string, FuncInfo>();
  funcs.set(func.name, func);

  const ctx: RecursiveInferCtx = {
    funcs,
    types: new Map(),
    params: [],
    bound: new Set(),
    changed: false,
  };
  ctx.bound.add(func.name);

  for (const param_name of func.params) {
    ctx.bound.add(param_name);
  }

  if (explicit_params) {
    for (const param_name in explicit_params) {
      if (ctx.funcs.has(param_name)) {
        throw new Error(
          "Open Ic parameter conflicts with recursive function: " + param_name,
        );
      }

      const type = explicit_params[param_name];

      if (!type) {
        throw new Error("Missing open Ic parameter type: " + param_name);
      }

      set_recursive_var_type(
        ctx,
        param_name,
        type,
        "$.params." + param_name,
      );
    }
  }

  let main_result: ValType | undefined;

  for (let iteration = 0; iteration < 32; iteration += 1) {
    ctx.changed = false;
    const next_main_result = infer_recursive_type(
      ctx,
      ic.body,
      main_result,
      "$.body",
    );

    if (next_main_result !== undefined) {
      if (main_result === undefined) {
        main_result = next_main_result;
        ctx.changed = true;
      } else {
        expect_type(next_main_result, main_result, "$.body");
      }
    }

    infer_recursive_func(ctx, func, "$.fix." + func.name);

    if (!ctx.changed) {
      break;
    }
  }

  const resolved_main_result = require_type(
    main_result,
    "Cannot infer recursive Ic main result type",
  );

  for (let index = 0; index < func.params.length; index += 1) {
    const param_name = func.params[index];
    expect(param_name, "Missing recursive Ic function parameter name");
    func.param_types[index] = require_type(
      func.param_types[index],
      "Cannot infer recursive Ic function parameter type: " + param_name,
    );
  }

  const resolved_func_result = require_type(
    func.result,
    "Cannot infer recursive Ic function result type: " + func.name,
  );
  func.result = resolved_func_result;

  return {
    func,
    funcs,
    types: ctx.types,
    params: ctx.params,
    main_result: resolved_main_result,
    func_result: resolved_func_result,
  };
}

function lambda_info(name: string, expr: Ic): FuncInfo {
  const params: string[] = [];
  const param_types: Array<ValType | undefined> = [];
  let cursor = expr;

  while (cursor.tag === "lam") {
    params.push(cursor.name);
    param_types.push(undefined);
    cursor = cursor.body;
  }

  if (params.length === 0) {
    throw new Error("Recursive Ic binding must be a lambda: " + name);
  }

  return {
    name,
    params,
    param_types,
    result: undefined,
    body: cursor,
  };
}

function infer_recursive_func(
  ctx: RecursiveInferCtx,
  func: FuncInfo,
  path: string,
): void {
  for (const param_name of func.params) {
    ctx.bound.add(param_name);
  }

  const body_type = infer_recursive_type(
    ctx,
    func.body,
    func.result,
    path + ".body",
  );

  if (body_type !== undefined) {
    set_func_result_type(ctx, func, body_type, path + ".body");
  }

  for (let index = 0; index < func.params.length; index += 1) {
    const param_name = func.params[index];
    expect(param_name, path + ": Missing function parameter");
    const type = ctx.types.get(param_name);

    if (type !== undefined) {
      set_func_param_type(ctx, func, index, type, path + ".params");
    }
  }
}

function infer_recursive_type(
  ctx: RecursiveInferCtx,
  ic: Ic,
  expected: ValType | undefined,
  path: string,
): ValType | undefined {
  switch (ic.tag) {
    case "num":
      return expect_type(ic.type, expected, path);

    case "text":
      throw new Error("Cannot lower text literal in recursive Ic WAT");

    case "var": {
      if (ctx.funcs.has(ic.name)) {
        throw new Error(
          path + ": Cannot use recursive Ic function as a value: " + ic.name,
        );
      }

      const current = ctx.types.get(ic.name);

      if (expected !== undefined) {
        set_recursive_var_type(ctx, ic.name, expected, path);
        return expected;
      }

      if (current !== undefined) {
        return current;
      }

      return undefined;
    }

    case "prim": {
      if (is_memory_prim(ic.prim)) {
        throw new Error(
          path + ": Cannot lower memory primitive in recursive Ic WAT: " +
            ic.prim,
        );
      }

      const prim_type = Callable.type(Prim, ic.prim);
      const expected_arity = Callable.arity(Prim, ic.prim);

      if (ic.args.length !== expected_arity) {
        throw new Error(
          path + ": Primitive " + ic.prim + " expects " + expected_arity +
            " arguments",
        );
      }

      for (let index = 0; index < ic.args.length; index += 1) {
        const arg = ic.args[index];
        const arg_type = prim_type.args[index];

        expect(arg, path + ": Missing primitive argument " + index);
        expect(arg_type, path + ": Missing primitive argument type " + index);
        infer_recursive_type(
          ctx,
          arg,
          arg_type,
          path + ".args[" + index.toString() + "]",
        );
      }

      return expect_type(prim_type.result, expected, path);
    }

    case "dup":
      return infer_recursive_dup_type(ctx, ic, expected, path);

    case "app":
      return infer_recursive_app_type(ctx, ic, expected, path);

    case "era":
      return infer_recursive_type(ctx, ic.body, expected, path + ".body");

    case "lam":
      throw new Error("Cannot lower nested lambda in recursive Ic WAT");

    case "sup":
      throw new Error("Cannot lower superposition in recursive Ic WAT");

    case "fix":
      throw new Error("Cannot lower nested fixpoint in recursive Ic WAT");
  }
}

function infer_recursive_app_type(
  ctx: RecursiveInferCtx,
  ic: Extract<Ic, { tag: "app" }>,
  expected: ValType | undefined,
  path: string,
): ValType | undefined {
  const app = collect_app(ic);

  if (app.func.tag !== "var") {
    throw new Error(
      path + ": Cannot lower non-symbolic call in recursive Ic WAT",
    );
  }

  const func = ctx.funcs.get(app.func.name);

  if (!func) {
    throw new Error(
      path + ": Cannot lower unknown call in recursive Ic WAT: " +
        app.func.name,
    );
  }

  if (app.args.length !== func.params.length) {
    throw new Error(
      path + ": Recursive Ic function " + func.name + " expects " +
        func.params.length.toString() + " arguments",
    );
  }

  for (let index = 0; index < app.args.length; index += 1) {
    const arg = app.args[index];
    const expected_arg = func.param_types[index];
    expect(arg, path + ": Missing call argument " + index);
    const arg_type = infer_recursive_type(
      ctx,
      arg,
      expected_arg,
      path + ".args[" + index.toString() + "]",
    );

    if (arg_type !== undefined) {
      set_func_param_type(ctx, func, index, arg_type, path);
    }
  }

  if (expected !== undefined) {
    set_func_result_type(ctx, func, expected, path);
    return expected;
  }

  if (func.result !== undefined) {
    return func.result;
  }

  return undefined;
}

function infer_recursive_dup_type(
  ctx: RecursiveInferCtx,
  ic: Extract<Ic, { tag: "dup" }>,
  expected: ValType | undefined,
  path: string,
): ValType | undefined {
  const left_name = ic.name + "0";
  const right_name = ic.name + "1";
  ctx.bound.add(left_name);
  ctx.bound.add(right_name);
  const body_type = infer_recursive_type(
    ctx,
    ic.body,
    expected,
    path + ".body",
  );
  const left_type = ctx.types.get(left_name);
  const right_type = ctx.types.get(right_name);
  let value_type = left_type;

  if (value_type === undefined) {
    value_type = right_type;
  }

  if (left_type !== undefined && right_type !== undefined) {
    if (left_type !== right_type) {
      throw new Error(
        path + ": Dup projections for " + ic.name + " have different types",
      );
    }
  }

  const expr_type = infer_recursive_type(
    ctx,
    ic.expr,
    value_type,
    path + ".expr",
  );

  if (value_type === undefined) {
    value_type = expr_type;
  }

  if (value_type !== undefined) {
    set_recursive_var_type(ctx, left_name, value_type, path + ".left");
    set_recursive_var_type(ctx, right_name, value_type, path + ".right");
  }

  return body_type;
}

function set_recursive_var_type(
  ctx: RecursiveInferCtx,
  name: string,
  type: ValType,
  path: string,
): void {
  const previous = ctx.types.get(name);

  if (previous !== undefined) {
    if (previous !== type) {
      throw new Error(
        path + ": Recursive Ic variable " + name + " inferred as both " +
          previous + " and " + type,
      );
    }

    return;
  }

  ctx.types.set(name, type);
  ctx.changed = true;

  if (!ctx.bound.has(name)) {
    ctx.params.push(name);
  }
}

function set_func_param_type(
  ctx: RecursiveInferCtx,
  func: FuncInfo,
  index: number,
  type: ValType,
  path: string,
): void {
  const current = func.param_types[index];

  if (current !== undefined) {
    if (current !== type) {
      throw new Error(
        path + ": Recursive Ic function " + func.name + " parameter " +
          index.toString() + " inferred as both " + current + " and " + type,
      );
    }

    return;
  }

  func.param_types[index] = type;
  ctx.changed = true;
}

function set_func_result_type(
  ctx: RecursiveInferCtx,
  func: FuncInfo,
  type: ValType,
  path: string,
): void {
  if (func.result !== undefined) {
    if (func.result !== type) {
      throw new Error(
        path + ": Recursive Ic function " + func.name +
          " result inferred as both " + func.result + " and " + type,
      );
    }

    return;
  }

  func.result = type;
  ctx.changed = true;
}

export function recursive_func_params(func: FuncInfo): FuncParam[] {
  const params: FuncParam[] = [];

  for (let index = 0; index < func.params.length; index += 1) {
    const name = func.params[index];
    expect(name, "Missing recursive Ic function parameter name");
    const type = require_type(
      func.param_types[index],
      "Missing recursive Ic function parameter type: " + name,
    );
    params.push({ name, type });
  }

  return params;
}

export function recursive_main_params(
  ctx: { params: string[]; types: Map<string, ValType> },
): FuncParam[] {
  const params: FuncParam[] = [];

  for (const name of ctx.params) {
    const type = require_type(
      ctx.types.get(name),
      "Missing recursive Ic main parameter type: " + name,
    );
    params.push({ name, type });
  }

  return params;
}

function require_type(
  type: ValType | undefined,
  message: string,
): ValType {
  expect(type !== undefined, message);
  return type;
}

function expect_type(
  actual: ValType,
  expected: ValType | undefined,
  path: string,
): ValType {
  if (expected !== undefined && actual !== expected) {
    throw new Error(
      path + ": Expected " + expected + ", got " + actual,
    );
  }

  return actual;
}
