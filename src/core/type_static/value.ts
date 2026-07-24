import { expect } from "../../expect.ts";
import type { TypeExpr } from "../../type_syntax.ts";
import type { CoreExpr } from "../ast.ts";
import {
  format_type_expr,
  parse_type_expr,
  tokenize,
} from "../from_source/type_contract.ts";
import { static_block_result } from "./block.ts";
import { is_core_builtin_type_name } from "./names.ts";
import { substitute_core_type_expr } from "./substitute.ts";
import type { TypeStaticCtx } from "./types.ts";

export function is_type_level_expr(expr: CoreExpr): boolean {
  switch (expr.tag) {
    case "type_name":
    case "struct_type":
    case "union_type":
    case "with":
    case "lam":
    case "rec":
      return true;

    case "num":
    case "text":
    case "var":
    case "linear":
    case "rec_ref":
    case "prim":
    case "app":
    case "block":
    case "loop":
    case "comptime":
    case "borrow":
    case "freeze":
    case "scratch":
    case "struct_value":
    case "struct_update":
    case "if":
    case "if_let":
    case "field":
    case "index":
    case "union_case":
    case "unsupported":
      return false;
  }
}

export function static_type_value(
  expr: CoreExpr,
  ctx: TypeStaticCtx,
): Extract<CoreExpr, { tag: "struct_type" | "union_type" }> | undefined {
  const value = static_type_level_value(expr, ctx);

  if (!value) {
    return undefined;
  }

  if (value.tag === "struct_type" || value.tag === "union_type") {
    return value;
  }

  return undefined;
}

export function static_type_name(
  expr: CoreExpr,
  ctx: TypeStaticCtx,
): Extract<CoreExpr, { tag: "type_name" }> | undefined {
  const value = static_type_level_value(expr, ctx);

  if (!value) {
    return undefined;
  }

  if (value.tag === "type_name") {
    return value;
  }

  return undefined;
}

export function static_function_value(
  expr: CoreExpr,
  ctx: TypeStaticCtx,
): Extract<CoreExpr, { tag: "lam" | "rec" }> | undefined {
  if (expr.tag === "lam" || expr.tag === "rec") {
    return expr;
  }

  if (expr.tag === "block") {
    const value = static_block_result(expr);

    if (!value) {
      return undefined;
    }

    return static_function_value(value, ctx);
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const value = ctx.statics.get(expr.name);

  if (!value) {
    return undefined;
  }

  return static_function_value(value, ctx);
}

export function static_type_level_value(
  expr: CoreExpr,
  ctx: TypeStaticCtx,
): CoreExpr | undefined {
  switch (expr.tag) {
    case "type_name":
    case "struct_type":
    case "union_type":
    case "lam":
    case "rec":
      return expr;

    case "with":
      return static_type_level_value(expr.base, ctx);

    case "block": {
      const value = static_block_result(expr);

      if (!value) {
        return undefined;
      }

      return static_type_level_value(value, ctx);
    }

    case "app":
      return static_type_constructor_call_value(expr, ctx);

    case "field":
      return static_type_extension_field_value(expr, ctx);

    case "var": {
      if (is_core_builtin_type_name(expr.name)) {
        return { tag: "type_name", name: expr.name };
      }

      const applied = static_applied_type_expr(expr.name);

      if (applied !== undefined) {
        return static_type_level_value(applied, ctx);
      }

      const value = ctx.statics.get(expr.name);

      if (!value) {
        return undefined;
      }

      return static_type_level_value(value, ctx);
    }

    case "num":
    case "text":
    case "linear":
    case "rec_ref":
    case "prim":
    case "comptime":
    case "borrow":
    case "freeze":
    case "scratch":
    case "struct_value":
    case "struct_update":
    case "if":
    case "if_let":
    case "index":
    case "union_case":
    case "unsupported":
      return undefined;
  }
}

function static_applied_type_expr(name: string): CoreExpr | undefined {
  let type: TypeExpr;
  try {
    type = parse_type_expr(tokenize(name));
  } catch (error) {
    if (error instanceof Error) {
      return undefined;
    }
    throw error;
  }

  if (type.tag !== "apply") {
    return undefined;
  }

  return core_type_application(type);
}

function core_type_application(type: TypeExpr): CoreExpr | undefined {
  if (type.tag === "name") {
    return { tag: "var", name: type.name };
  }
  if (type.tag !== "apply") {
    return undefined;
  }

  const func = core_type_application(type.func);
  const arg = core_type_application(type.arg);
  if (func === undefined || arg === undefined) {
    return undefined;
  }

  return { tag: "app", func, args: [arg] };
}

function static_type_extension_field_value(
  expr: Extract<CoreExpr, { tag: "field" }>,
  ctx: TypeStaticCtx,
): CoreExpr | undefined {
  // Type-valued extension fields form closed compile-time namespaces. Resolve
  // the selected field before ordinary union or struct lowering sees it.
  const extension = static_extension_value(expr.object, ctx);

  if (!extension) {
    return undefined;
  }

  for (let index = extension.fields.length - 1; index >= 0; index -= 1) {
    const field = extension.fields[index];
    expect(field, "Missing static extension field " + index.toString());

    if (field.name === expr.name) {
      return static_type_level_value(field.value, ctx);
    }
  }

  return static_type_extension_field_value(
    { tag: "field", object: extension.base, name: expr.name },
    ctx,
  );
}

function static_extension_value(
  expr: CoreExpr,
  ctx: TypeStaticCtx,
): Extract<CoreExpr, { tag: "with" }> | undefined {
  if (expr.tag === "with") {
    return expr;
  }

  if (expr.tag === "block") {
    const value = static_block_result(expr);

    if (!value) {
      return undefined;
    }

    return static_extension_value(value, ctx);
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const value = ctx.statics.get(expr.name);

  if (!value) {
    return undefined;
  }

  return static_extension_value(value, ctx);
}

export function resolve_core_type_name(
  name: string,
  ctx: TypeStaticCtx,
): string {
  if (is_core_builtin_type_name(name)) {
    return name;
  }

  const type_name = static_type_name({ tag: "var", name }, ctx);

  if (type_name) {
    return type_name.name;
  }

  return name;
}

function static_type_constructor_call_value(
  expr: Extract<CoreExpr, { tag: "app" }>,
  ctx: TypeStaticCtx,
): CoreExpr | undefined {
  const target = static_type_level_value(expr.func, ctx);

  if (!target) {
    return undefined;
  }

  if (target.tag !== "lam") {
    return undefined;
  }

  if (target.params.some((param) => param.annotation !== undefined)) {
    return undefined;
  }

  expect(
    expr.args.length === target.params.length,
    "Core type constructor expects " + target.params.length + " arguments",
  );
  const type_args = new Map<string, string>();

  for (let index = 0; index < target.params.length; index += 1) {
    const param = target.params[index];
    const arg = expr.args[index];
    expect(param, "Missing core type constructor parameter " + index);
    expect(arg, "Missing core type constructor argument " + index);
    const type_name = static_type_argument_name(arg, ctx);
    if (!type_name) {
      return undefined;
    }
    type_args.set(param.name, type_name);
  }

  const value = substitute_core_type_expr(target.body, type_args);
  return static_type_level_value(value, ctx);
}

function static_type_argument_name(
  expr: CoreExpr,
  ctx: TypeStaticCtx,
): string | undefined {
  const type_name = static_type_name(expr, ctx);

  if (type_name) {
    return type_name.name;
  }

  if (expr.tag === "app") {
    const type_value = static_type_value(expr, ctx);
    const type_expr = source_type_application(expr);
    if (type_value !== undefined && type_expr !== undefined) {
      return format_type_expr(type_expr);
    }
  }

  if (expr.tag !== "var") {
    return undefined;
  }

  const value = ctx.statics.get(expr.name);

  if (!value) {
    return undefined;
  }

  const type_value = static_type_value(value, ctx);

  if (type_value) {
    return expr.name;
  }

  return undefined;
}

function source_type_application(expr: CoreExpr): TypeExpr | undefined {
  if (expr.tag === "var") {
    return { tag: "name", name: expr.name };
  }
  if (expr.tag !== "app" || expr.args.length !== 1) {
    return undefined;
  }

  const func = source_type_application(expr.func);
  const arg = expr.args[0];
  if (func === undefined || arg === undefined) {
    return undefined;
  }
  const source_arg = source_type_application(arg);
  if (source_arg === undefined) {
    return undefined;
  }

  return { tag: "apply", func, arg: source_arg };
}
