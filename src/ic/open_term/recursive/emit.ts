import { expect } from "../../../expect.ts";
import { Prim, type ValType } from "../../../op.ts";
import { Callable, Emit } from "../../../trait.ts";
import { indent, type Wat } from "../../../wat.ts";
import type { Ic } from "../../ast.ts";
import { collect_app, is_memory_prim } from "./shared.ts";
import type { EmitRecursiveCtx, FuncInfo } from "./types.ts";

export function emit_recursive_func_body(
  func: FuncInfo,
  types: Map<string, ValType>,
  funcs: Map<string, FuncInfo>,
): Wat {
  const ctx: EmitRecursiveCtx = {
    funcs,
    types,
    aliases: new Map(),
    locals: new Map(),
  };
  const body = emit_recursive_ic(ctx, func.body);
  return with_local_decls(body, ctx.locals, func.params);
}

export function emit_recursive_main_body(
  body_ic: Ic,
  types: Map<string, ValType>,
  funcs: Map<string, FuncInfo>,
): Wat {
  const ctx: EmitRecursiveCtx = {
    funcs,
    types,
    aliases: new Map(),
    locals: new Map(),
  };
  const body = emit_recursive_ic(ctx, body_ic);
  return with_local_decls(body, ctx.locals, []);
}

function with_local_decls(
  body: Wat,
  locals: Map<string, ValType>,
  params: string[],
): Wat {
  const lines: string[] = [];

  for (const [name, type] of locals) {
    if (!params.includes(name)) {
      lines.push("(local $" + name + " " + type + ")");
    }
  }

  lines.push(body);
  return lines.join("\n");
}

function emit_recursive_ic(ctx: EmitRecursiveCtx, ic: Ic): Wat {
  switch (ic.tag) {
    case "num":
      return ic.type + ".const " + ic.value.toString();

    case "var":
      return "local.get $" + resolved_name(ctx, ic.name);

    case "prim":
      return emit_recursive_prim(ctx, ic);

    case "app":
      return emit_recursive_app(ctx, ic);

    case "dup":
      return emit_recursive_dup(ctx, ic);

    case "era":
      return emit_recursive_ic(ctx, ic.body);

    case "text":
      throw new Error("Cannot lower text literal in recursive Ic WAT");

    case "lam":
      throw new Error("Cannot lower nested lambda in recursive Ic WAT");

    case "sup":
      throw new Error("Cannot lower superposition in recursive Ic WAT");

    case "fix":
      throw new Error("Cannot lower nested fixpoint in recursive Ic WAT");
  }
}

function emit_recursive_prim(
  ctx: EmitRecursiveCtx,
  ic: Extract<Ic, { tag: "prim" }>,
): Wat {
  if (is_memory_prim(ic.prim)) {
    throw new Error(
      "Cannot lower memory primitive in recursive Ic WAT: " + ic.prim,
    );
  }

  const expected_arity = Callable.arity(Prim, ic.prim);

  if (ic.args.length !== expected_arity) {
    throw new Error(
      "Primitive " + ic.prim + " expects " + expected_arity + " arguments",
    );
  }

  if (is_select_prim(ic.prim)) {
    const then_expr = ic.args[0];
    const else_expr = ic.args[1];
    const cond_expr = ic.args[2];
    expect(then_expr, "Missing select then branch");
    expect(else_expr, "Missing select else branch");
    expect(cond_expr, "Missing select condition");
    const prim_type = Callable.type(Prim, ic.prim);

    return [
      emit_recursive_ic(ctx, cond_expr),
      "if (result " + prim_type.result + ")",
      indent(emit_recursive_ic(ctx, then_expr), 2),
      "else",
      indent(emit_recursive_ic(ctx, else_expr), 2),
      "end",
    ].join("\n");
  }

  const lines: string[] = [];

  for (const arg of ic.args) {
    lines.push(emit_recursive_ic(ctx, arg));
  }

  lines.push(Emit.emit(Prim, ic.prim));
  return lines.join("\n");
}

function emit_recursive_app(
  ctx: EmitRecursiveCtx,
  ic: Extract<Ic, { tag: "app" }>,
): Wat {
  const app = collect_app(ic);

  if (app.func.tag !== "var") {
    throw new Error("Cannot lower non-symbolic call in recursive Ic WAT");
  }

  const func = ctx.funcs.get(app.func.name);

  if (!func) {
    throw new Error(
      "Cannot lower unknown call in recursive Ic WAT: " + app.func.name,
    );
  }

  if (app.args.length !== func.params.length) {
    throw new Error(
      "Recursive Ic function " + func.name + " expects " +
        func.params.length.toString() + " arguments",
    );
  }

  const lines: string[] = [];

  for (const arg of app.args) {
    lines.push(emit_recursive_ic(ctx, arg));
  }

  lines.push("call $" + func.name);
  return lines.join("\n");
}

function emit_recursive_dup(
  ctx: EmitRecursiveCtx,
  ic: Extract<Ic, { tag: "dup" }>,
): Wat {
  const value_type = dup_value_type(ctx, ic);
  set_emit_local(ctx, ic.name, value_type);

  const left_name = ic.name + "0";
  const right_name = ic.name + "1";
  const had_left = ctx.aliases.has(left_name);
  const previous_left = ctx.aliases.get(left_name);
  const had_right = ctx.aliases.has(right_name);
  const previous_right = ctx.aliases.get(right_name);
  const expr = emit_recursive_ic(ctx, ic.expr);
  ctx.aliases.set(left_name, ic.name);
  ctx.aliases.set(right_name, ic.name);
  const body = emit_recursive_ic(ctx, ic.body);
  restore_alias(ctx, left_name, had_left, previous_left);
  restore_alias(ctx, right_name, had_right, previous_right);

  return [
    expr,
    "local.set $" + ic.name,
    body,
  ].join("\n");
}

function dup_value_type(
  ctx: EmitRecursiveCtx,
  ic: Extract<Ic, { tag: "dup" }>,
): ValType {
  const left_name = ic.name + "0";
  const right_name = ic.name + "1";
  const left_type = ctx.types.get(left_name);
  const right_type = ctx.types.get(right_name);
  let value_type = left_type;

  if (value_type === undefined) {
    value_type = right_type;
  }

  if (left_type !== undefined && right_type !== undefined) {
    if (left_type !== right_type) {
      throw new Error(
        "Dup projections for " + ic.name + " have different types",
      );
    }
  }

  expect(
    value_type !== undefined,
    "Cannot infer recursive Ic dup value type: " + ic.name,
  );
  return value_type;
}

function set_emit_local(
  ctx: EmitRecursiveCtx,
  name: string,
  type: ValType,
): void {
  const previous = ctx.locals.get(name);

  if (previous !== undefined) {
    if (previous !== type) {
      throw new Error(
        "Recursive Ic local " + name + " inferred as both " + previous +
          " and " + type,
      );
    }

    return;
  }

  ctx.locals.set(name, type);
}

function resolved_name(ctx: EmitRecursiveCtx, name: string): string {
  const alias = ctx.aliases.get(name);

  if (alias !== undefined) {
    return alias;
  }

  return name;
}

function restore_alias(
  ctx: EmitRecursiveCtx,
  name: string,
  had_alias: boolean,
  previous: string | undefined,
): void {
  if (had_alias) {
    expect(previous !== undefined, "Missing previous alias for " + name);
    ctx.aliases.set(name, previous);
    return;
  }

  ctx.aliases.delete(name);
}

function is_select_prim(prim: Prim): boolean {
  if (prim === "i32.select") {
    return true;
  }

  if (prim === "i64.select") {
    return true;
  }

  return false;
}
