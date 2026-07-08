import { expect } from "../expect.ts";
import { Prim } from "../op.ts";
import { Callable, Reduce } from "../trait.ts";
import type { Ic } from "./ast.ts";
import { reduce_ic_graph } from "./graph_reduce.ts";
import { fold_prim, fold_select, is_binary_prim } from "./prim_reduce.ts";
import { create_ic_reduce_ctx, type IcReduceCtx } from "./reduce/context.ts";
import { erase_ic } from "./reduce/erase.ts";
import { spread_prim } from "./reduce/prim_spread.ts";
import { ic_name_use_count, subst_ic } from "./reduce/substitute.ts";

type IcStep = Ic;
type PrimCall = Extract<Ic, { tag: "prim" }>;
type Lam = Extract<Ic, { tag: "lam" }>;
type App = Extract<Ic, { tag: "app" }>;
type Sup = Extract<Ic, { tag: "sup" }>;
type Dup = Extract<Ic, { tag: "dup" }>;
type Era = Extract<Ic, { tag: "era" }>;
type DupSup = [dup: Dup, sup: Sup];
type DupLam = [dup: Dup, lam: Lam];

function IcStep() {}
function PrimCall() {}
function Lam() {}
function App() {}
function Sup() {}
function Dup() {}
function Era() {}
function DupSup() {}
function DupLam() {}

export function reduce_ic(ic: Ic): Ic {
  const ctx = create_ic_reduce_ctx(ic);
  return Reduce.reduce(IcStep, ctx, ic);
}

IcStep.reduce = function (ctx: IcReduceCtx, ic: IcStep): Ic {
  switch (ic.tag) {
    case "num":
    case "text":
    case "var":
      return ic;

    case "prim":
      return Reduce.reduce(PrimCall, ctx, ic);

    case "lam":
      return Reduce.reduce(Lam, ctx, ic);

    case "app":
      return Reduce.reduce(App, ctx, ic);

    case "sup":
      return Reduce.reduce(Sup, ctx, ic);

    case "dup":
      return Reduce.reduce(Dup, ctx, ic);

    case "era":
      return Reduce.reduce(Era, ctx, ic);

    case "fix":
      return reduce_ic_graph(ic);
  }
};

IcStep satisfies Reduce<IcReduceCtx, IcStep, Ic>;

PrimCall.reduce = function (ctx: IcReduceCtx, ic: PrimCall): Ic {
  const expected = Callable.arity(Prim, ic.prim);
  expect(
    ic.args.length === expected,
    "Primitive " + ic.prim + " expects " + expected + " arguments",
  );

  const args = Reduce.all(IcStep, ctx, ic.args);

  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    expect(item, "Missing primitive argument " + index);

    if (item.tag === "sup") {
      const body = spread_prim(ic.prim, args, index, item, ctx);
      return Reduce.reduce(IcStep, ctx, body);
    }
  }

  if (ic.prim === "i32.select" || ic.prim === "i64.select") {
    return fold_select(ic.prim, args);
  }

  if (expected === 0) {
    return { tag: "prim", prim: ic.prim, args };
  }

  if (expected !== 2) {
    return { tag: "prim", prim: ic.prim, args };
  }

  expect(is_binary_prim(ic.prim), "Expected binary primitive: " + ic.prim);
  const left = args[0];
  const right = args[1];
  expect(left, "Missing primitive argument 0");
  expect(right, "Missing primitive argument 1");

  if (left.tag === "num" && right.tag === "num") {
    return fold_prim(ic.prim, left, right);
  }

  return {
    tag: "prim",
    prim: ic.prim,
    args,
  };
};

PrimCall satisfies Reduce<IcReduceCtx, PrimCall, Ic>;

Lam.reduce = function (ctx: IcReduceCtx, ic: Lam): Ic {
  return {
    tag: "lam",
    name: ic.name,
    body: Reduce.reduce(IcStep, ctx, ic.body),
  };
};

Lam satisfies Reduce<IcReduceCtx, Lam, Ic>;

App.reduce = function (ctx: IcReduceCtx, ic: App): Ic {
  const func = Reduce.reduce(IcStep, ctx, ic.func);
  const value = Reduce.reduce(IcStep, ctx, ic.arg);

  if (func.tag === "lam") {
    return Reduce.reduce(IcStep, ctx, subst_ic(func.body, func.name, value));
  }

  if (func.tag === "sup") {
    const name = ctx.name("x");
    return Reduce.reduce(
      IcStep,
      ctx,
      {
        tag: "dup",
        label: func.label,
        name,
        expr: value,
        body: {
          tag: "sup",
          label: func.label,
          left: {
            tag: "app",
            func: func.left,
            arg: { tag: "var", name: `${name}0` },
          },
          right: {
            tag: "app",
            func: func.right,
            arg: { tag: "var", name: `${name}1` },
          },
        },
      },
    );
  }

  return { tag: "app", func, arg: value };
};

App satisfies Reduce<IcReduceCtx, App, Ic>;

Sup.reduce = function (ctx: IcReduceCtx, ic: Sup): Ic {
  return {
    tag: "sup",
    label: ic.label,
    left: Reduce.reduce(IcStep, ctx, ic.left),
    right: Reduce.reduce(IcStep, ctx, ic.right),
  };
};

Sup satisfies Reduce<IcReduceCtx, Sup, Ic>;

Dup.reduce = function (ctx: IcReduceCtx, ic: Dup): Ic {
  const expr = Reduce.reduce(IcStep, ctx, ic.expr);

  if (expr.tag === "sup") {
    return Reduce.reduce(DupSup, ctx, [ic, expr]);
  }

  if (expr.tag === "lam") {
    return Reduce.reduce(DupLam, ctx, [ic, expr]);
  }

  if (expr.tag === "num" || expr.tag === "text") {
    const left = subst_ic(ic.body, `${ic.name}0`, expr);
    const right = subst_ic(left, `${ic.name}1`, expr);
    return Reduce.reduce(IcStep, ctx, right);
  }

  const body = Reduce.reduce(IcStep, ctx, ic.body);
  const left_name = `${ic.name}0`;
  const right_name = `${ic.name}1`;
  const left_uses = ic_name_use_count(body, left_name);
  const right_uses = ic_name_use_count(body, right_name);

  if (left_uses === 0 && right_uses === 0) {
    return Reduce.reduce(IcStep, ctx, { tag: "era", expr, body });
  }

  if (left_uses === 0 && right_uses === 1) {
    return Reduce.reduce(IcStep, ctx, subst_ic(body, right_name, expr));
  }

  if (left_uses === 1 && right_uses === 0) {
    return Reduce.reduce(IcStep, ctx, subst_ic(body, left_name, expr));
  }

  return {
    tag: "dup",
    label: ic.label,
    name: ic.name,
    expr,
    body,
  };
};

Dup satisfies Reduce<IcReduceCtx, Dup, Ic>;

Era.reduce = function (ctx: IcReduceCtx, ic: Era): Ic {
  const expr = Reduce.reduce(IcStep, ctx, ic.expr);
  const body = erase_ic(expr, ic.body);
  return Reduce.reduce(IcStep, ctx, body);
};

Era satisfies Reduce<IcReduceCtx, Era, Ic>;

DupSup.reduce = function (ctx: IcReduceCtx, pair: DupSup): Ic {
  const [ic, expr] = pair;

  if (expr.label === ic.label) {
    const left = subst_ic(ic.body, `${ic.name}0`, expr.left);
    const right = subst_ic(left, `${ic.name}1`, expr.right);
    return Reduce.reduce(IcStep, ctx, right);
  }

  const left_name = ctx.name("a");
  const right_name = ctx.name("b");
  const left_projection: Ic = {
    tag: "sup",
    label: expr.label,
    left: { tag: "var", name: `${left_name}0` },
    right: { tag: "var", name: `${right_name}0` },
  };
  const right_projection: Ic = {
    tag: "sup",
    label: expr.label,
    left: { tag: "var", name: `${left_name}1` },
    right: { tag: "var", name: `${right_name}1` },
  };
  const left = subst_ic(ic.body, `${ic.name}0`, left_projection);
  const right = subst_ic(left, `${ic.name}1`, right_projection);

  return Reduce.reduce(
    IcStep,
    ctx,
    {
      tag: "dup",
      label: ic.label,
      name: left_name,
      expr: expr.left,
      body: {
        tag: "dup",
        label: ic.label,
        name: right_name,
        expr: expr.right,
        body: right,
      },
    },
  );
};

DupSup satisfies Reduce<IcReduceCtx, DupSup, Ic>;

DupLam.reduce = function (ctx: IcReduceCtx, pair: DupLam): Ic {
  const [ic, expr] = pair;

  const body_name = ctx.name("b");
  const left_name = ctx.var(expr.name);
  const right_name = ctx.var(expr.name);
  const shared_body = subst_ic(expr.body, expr.name, {
    tag: "sup",
    label: ic.label,
    left: { tag: "var", name: left_name },
    right: { tag: "var", name: right_name },
  });

  const left_func: Ic = {
    tag: "lam",
    name: left_name,
    body: { tag: "var", name: `${body_name}0` },
  };
  const right_func: Ic = {
    tag: "lam",
    name: right_name,
    body: { tag: "var", name: `${body_name}1` },
  };

  const left = subst_ic(ic.body, `${ic.name}0`, left_func);
  const right = subst_ic(left, `${ic.name}1`, right_func);
  return Reduce.reduce(
    IcStep,
    ctx,
    {
      tag: "dup",
      label: ic.label,
      name: body_name,
      expr: shared_body,
      body: right,
    },
  );
};

DupLam satisfies Reduce<IcReduceCtx, DupLam, Ic>;
