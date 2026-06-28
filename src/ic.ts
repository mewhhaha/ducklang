import { expect } from "./expect.ts";
import { Expr, type Expr as ExprNode } from "./expr.ts";
import { Prim, type ValType } from "./op.ts";
import type { Emit, Format, Reduce } from "./trait.ts";

export type Ic =
  | { tag: "num"; type: ValType; value: number | bigint }
  | { tag: "var"; name: string }
  | { tag: "prim"; prim: Prim; args: Ic[] }
  | { tag: "lam"; name: string; body: Ic }
  | { tag: "app"; func: Ic; arg: Ic }
  | { tag: "sup"; label: string; left: Ic; right: Ic }
  | { tag: "dup"; label: string; name: string; expr: Ic; body: Ic }
  | { tag: "era"; expr: Ic; body: Ic };

type Ctx = {
  used: Set<string>;
  next: number;
  name: (prefix: string) => string;
  var: (prefix: string) => string;
};

type PrimCall = Extract<Ic, { tag: "prim" }>;
type Lam = Extract<Ic, { tag: "lam" }>;
type App = Extract<Ic, { tag: "app" }>;
type Sup = Extract<Ic, { tag: "sup" }>;
type Dup = Extract<Ic, { tag: "dup" }>;
type Era = Extract<Ic, { tag: "era" }>;
type Num = Extract<Ic, { tag: "num" }>;
type DupSup = [dup: Dup, sup: Sup];
type DupLam = [dup: Dup, lam: Lam];
type I32Prim = Extract<Prim, `i32.${string}`>;
type I64Prim = Extract<Prim, `i64.${string}`>;

export function Ic() {}
function PrimCall() {}
function Lam() {}
function App() {}
function Sup() {}
function Dup() {}
function Era() {}
function DupSup() {}
function DupLam() {}

function arg(args: Ic[], index: number): Ic {
  const value = args[index];
  expect(value, "Missing argument " + index);
  return value;
}

Ic.fmt = function fmt(ic: Ic): string {
  switch (ic.tag) {
    case "num":
      return ic.value.toString() + ":" + ic.type;

    case "var":
      return ic.name;

    case "prim": {
      const expected = Prim.arity(ic.prim);
      expect(
        ic.args.length === expected,
        "Primitive " + ic.prim + " expects " + expected + " arguments",
      );

      const left = fmt(arg(ic.args, 0));
      const op = Prim.fmt(ic.prim);
      const right = fmt(arg(ic.args, 1));
      return `${left} ${op} ${right}`;
    }

    case "lam": {
      const body = fmt(ic.body);
      return `λ${ic.name}. ${body}`;
    }

    case "app": {
      const func = fmt(ic.func);
      const value = fmt(ic.arg);
      return `(${func})(${value})`;
    }

    case "sup": {
      const left = fmt(ic.left);
      const right = fmt(ic.right);
      return `&${ic.label}{${left}, ${right}}`;
    }

    case "dup": {
      const expr = fmt(ic.expr);
      const body = fmt(ic.body);
      return `! ${ic.name} &${ic.label} = ${expr};\n${body}`;
    }

    case "era": {
      const expr = fmt(ic.expr);
      const body = fmt(ic.body);
      return `~ ${expr};\n${body}`;
    }
  }
};

Ic.reduce = function (ic: Ic): Ic {
  const ctx = Ctx(ic);
  return reduce(ctx, ic);
};

Ic.emit = function emit(ic: Ic): ExprNode {
  return lower(Ic.reduce(ic), new Map());
};

Ic satisfies Format<Ic> & Emit<Ic, ExprNode>;

function reduce(ctx: Ctx, ic: Ic): Ic {
  switch (ic.tag) {
    case "num":
    case "var":
      return ic;

    case "prim":
      return PrimCall.reduce(ctx, ic);

    case "lam":
      return Lam.reduce(ctx, ic);

    case "app":
      return App.reduce(ctx, ic);

    case "sup":
      return Sup.reduce(ctx, ic);

    case "dup":
      return Dup.reduce(ctx, ic);

    case "era":
      return Era.reduce(ctx, ic);
  }
}

PrimCall.reduce = function (ctx: Ctx, ic: PrimCall): Ic {
  const expected = Prim.arity(ic.prim);
  expect(
    ic.args.length === expected,
    "Primitive " + ic.prim + " expects " + expected + " arguments",
  );

  const args = ic.args.map((item) => reduce(ctx, item));

  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    expect(item, "Missing primitive argument " + index);

    if (item.tag === "sup") {
      const body = spreadPrim(ic.prim, args, index, item, ctx);
      return reduce(ctx, body);
    }
  }

  const left = arg(args, 0);
  const right = arg(args, 1);

  if (left.tag === "num" && right.tag === "num") {
    return foldPrim(ic.prim, left, right);
  }

  return {
    tag: "prim",
    prim: ic.prim,
    args,
  };
};

PrimCall satisfies Reduce<Ctx, PrimCall, Ic>;

function spreadPrim(
  prim: Prim,
  args: Ic[],
  index: number,
  sup: Extract<Ic, { tag: "sup" }>,
  ctx: Ctx,
): Ic {
  const leftArgs: Ic[] = [];
  const rightArgs: Ic[] = [];
  const copyNames: string[] = [];
  const copyExprs: Ic[] = [];

  for (let pos = 0; pos < args.length; pos += 1) {
    const input = args[pos];
    expect(input, "Missing primitive argument " + pos);

    if (pos === index) {
      leftArgs.push(sup.left);
      rightArgs.push(sup.right);
    } else {
      const name = ctx.name("p");
      copyNames.push(name);
      copyExprs.push(input);
      leftArgs.push({ tag: "var", name: `${name}0` });
      rightArgs.push({ tag: "var", name: `${name}1` });
    }
  }

  let body: Ic = {
    tag: "sup",
    label: sup.label,
    left: { tag: "prim", prim, args: leftArgs },
    right: { tag: "prim", prim, args: rightArgs },
  };

  for (let copy = copyNames.length - 1; copy >= 0; copy -= 1) {
    const name = copyNames[copy];
    const expr = copyExprs[copy];
    expect(name, "Missing copied primitive name");
    expect(expr, "Missing copied primitive expression");

    body = {
      tag: "dup",
      label: sup.label,
      name,
      expr,
      body,
    };
  }

  return body;
}

function foldPrim(
  prim: Prim,
  left: Num,
  right: Num,
): Ic {
  expect(left.type === right.type, "Primitive numbers must have the same type");

  const primType = Prim.type(prim);
  const leftExpected = primType.args[0];
  const rightExpected = primType.args[1];
  expect(leftExpected, "Missing primitive argument type 0");
  expect(rightExpected, "Missing primitive argument type 1");
  expect(
    left.type === leftExpected,
    "Primitive " + prim + " argument 0 expects " + leftExpected + ", got " +
      left.type,
  );
  expect(
    right.type === rightExpected,
    "Primitive " + prim + " argument 1 expects " + rightExpected + ", got " +
      right.type,
  );
  expect(
    primType.result === left.type,
    "Primitive " + prim + " returns " + primType.result + ", got " + left.type,
  );

  switch (prim) {
    case "i32.add":
    case "i32.sub":
    case "i32.mul":
      return foldI32(prim, left, right);

    case "i64.add":
    case "i64.sub":
    case "i64.mul":
      return foldI64(prim, left, right);
  }
}

function foldI32(
  prim: I32Prim,
  left: Num,
  right: Num,
): Ic {
  const leftValue = left.value;
  const rightValue = right.value;
  expect(typeof leftValue === "number", "Expected i32 number");
  expect(typeof rightValue === "number", "Expected i32 number");

  switch (prim) {
    case "i32.add":
      return { tag: "num", type: "i32", value: (leftValue + rightValue) | 0 };

    case "i32.sub":
      return { tag: "num", type: "i32", value: (leftValue - rightValue) | 0 };

    case "i32.mul":
      return {
        tag: "num",
        type: "i32",
        value: Math.imul(leftValue, rightValue),
      };
  }
}

function foldI64(
  prim: I64Prim,
  left: Num,
  right: Num,
): Ic {
  const leftValue = left.value;
  const rightValue = right.value;
  expect(typeof leftValue === "bigint", "Expected i64 bigint");
  expect(typeof rightValue === "bigint", "Expected i64 bigint");

  switch (prim) {
    case "i64.add":
      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, leftValue + rightValue),
      };

    case "i64.sub":
      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, leftValue - rightValue),
      };

    case "i64.mul":
      return {
        tag: "num",
        type: "i64",
        value: BigInt.asIntN(64, leftValue * rightValue),
      };
  }
}

Lam.reduce = function (ctx: Ctx, ic: Lam): Ic {
  return {
    tag: "lam",
    name: ic.name,
    body: reduce(ctx, ic.body),
  };
};

Lam satisfies Reduce<Ctx, Lam, Ic>;

App.reduce = function (ctx: Ctx, ic: App): Ic {
  const func = reduce(ctx, ic.func);
  const value = reduce(ctx, ic.arg);

  if (func.tag === "lam") {
    return reduce(ctx, subst(func.body, func.name, value));
  }

  if (func.tag === "sup") {
    const name = ctx.name("x");
    return reduce(
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

App satisfies Reduce<Ctx, App, Ic>;

Sup.reduce = function (ctx: Ctx, ic: Sup): Ic {
  return {
    tag: "sup",
    label: ic.label,
    left: reduce(ctx, ic.left),
    right: reduce(ctx, ic.right),
  };
};

Sup satisfies Reduce<Ctx, Sup, Ic>;

Dup.reduce = function (ctx: Ctx, ic: Dup): Ic {
  const expr = reduce(ctx, ic.expr);

  if (expr.tag === "sup") {
    return DupSup.reduce(ctx, [ic, expr]);
  }

  if (expr.tag === "lam") {
    return DupLam.reduce(ctx, [ic, expr]);
  }

  const body = reduce(ctx, ic.body);
  return {
    tag: "dup",
    label: ic.label,
    name: ic.name,
    expr,
    body,
  };
};

Dup satisfies Reduce<Ctx, Dup, Ic>;

Era.reduce = function (ctx: Ctx, ic: Era): Ic {
  const expr = reduce(ctx, ic.expr);
  const body = erase(expr, ic.body);
  return reduce(ctx, body);
};

Era satisfies Reduce<Ctx, Era, Ic>;

DupSup.reduce = function (ctx: Ctx, pair: DupSup): Ic {
  const [ic, expr] = pair;

  if (expr.label === ic.label) {
    const left = subst(ic.body, `${ic.name}0`, expr.left);
    const right = subst(left, `${ic.name}1`, expr.right);
    return reduce(ctx, right);
  }

  const leftName = ctx.name("a");
  const rightName = ctx.name("b");
  const leftProjection: Ic = {
    tag: "sup",
    label: expr.label,
    left: { tag: "var", name: `${leftName}0` },
    right: { tag: "var", name: `${rightName}0` },
  };
  const rightProjection: Ic = {
    tag: "sup",
    label: expr.label,
    left: { tag: "var", name: `${leftName}1` },
    right: { tag: "var", name: `${rightName}1` },
  };
  const left = subst(ic.body, `${ic.name}0`, leftProjection);
  const right = subst(left, `${ic.name}1`, rightProjection);

  return reduce(
    ctx,
    {
      tag: "dup",
      label: ic.label,
      name: leftName,
      expr: expr.left,
      body: {
        tag: "dup",
        label: ic.label,
        name: rightName,
        expr: expr.right,
        body: right,
      },
    },
  );
};

DupSup satisfies Reduce<Ctx, DupSup, Ic>;

DupLam.reduce = function (ctx: Ctx, pair: DupLam): Ic {
  const [ic, expr] = pair;

  const bodyName = ctx.name("b");
  const leftName = ctx.var(expr.name);
  const rightName = ctx.var(expr.name);
  const sharedBody = subst(expr.body, expr.name, {
    tag: "sup",
    label: ic.label,
    left: { tag: "var", name: leftName },
    right: { tag: "var", name: rightName },
  });

  const leftFunc: Ic = {
    tag: "lam",
    name: leftName,
    body: { tag: "var", name: `${bodyName}0` },
  };
  const rightFunc: Ic = {
    tag: "lam",
    name: rightName,
    body: { tag: "var", name: `${bodyName}1` },
  };

  const left = subst(ic.body, `${ic.name}0`, leftFunc);
  const right = subst(left, `${ic.name}1`, rightFunc);
  return reduce(
    ctx,
    {
      tag: "dup",
      label: ic.label,
      name: bodyName,
      expr: sharedBody,
      body: right,
    },
  );
};

DupLam satisfies Reduce<Ctx, DupLam, Ic>;

function erase(expr: Ic, body: Ic): Ic {
  switch (expr.tag) {
    case "num":
    case "var":
      return body;

    case "prim":
      return eraseMany(expr.args, body);

    case "lam":
      return { tag: "era", expr: expr.body, body };

    case "app":
      return eraseMany([expr.func, expr.arg], body);

    case "sup":
      return eraseMany([expr.left, expr.right], body);

    case "dup": {
      const left: Ic = { tag: "var", name: `${expr.name}0` };
      const right: Ic = { tag: "var", name: `${expr.name}1` };
      const next = eraseMany([left, right], expr.body);
      return eraseMany([expr.expr, next], body);
    }

    case "era":
      return eraseMany([expr.expr, expr.body], body);
  }
}

function eraseMany(items: Ic[], next: Ic): Ic {
  let result = next;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    expect(item, "Missing erasure item " + index);
    result = { tag: "era", expr: item, body: result };
  }

  return result;
}

function Ctx(ic: Ic): Ctx {
  const ctx: Ctx = {
    used: collectNames(ic),
    next: 0,
    name(prefix: string): string {
      while (true) {
        const name = "_" + prefix + ctx.next.toString();
        ctx.next += 1;

        if (
          !ctx.used.has(name) &&
          !ctx.used.has(`${name}0`) &&
          !ctx.used.has(`${name}1`)
        ) {
          ctx.used.add(name);
          ctx.used.add(`${name}0`);
          ctx.used.add(`${name}1`);
          return name;
        }
      }
    },
    var(prefix: string): string {
      while (true) {
        const name = "_" + prefix + ctx.next.toString();
        ctx.next += 1;

        if (!ctx.used.has(name)) {
          ctx.used.add(name);
          return name;
        }
      }
    },
  };

  return ctx;
}

function collectNames(ic: Ic, out = new Set<string>()): Set<string> {
  switch (ic.tag) {
    case "num":
      return out;

    case "var":
      out.add(ic.name);
      return out;

    case "prim":
      for (const item of ic.args) {
        collectNames(item, out);
      }

      return out;

    case "lam":
      out.add(ic.name);
      collectNames(ic.body, out);
      return out;

    case "app":
      collectNames(ic.func, out);
      collectNames(ic.arg, out);
      return out;

    case "sup":
      collectNames(ic.left, out);
      collectNames(ic.right, out);
      return out;

    case "dup":
      out.add(ic.name);
      out.add(`${ic.name}0`);
      out.add(`${ic.name}1`);
      collectNames(ic.expr, out);
      collectNames(ic.body, out);
      return out;

    case "era":
      collectNames(ic.expr, out);
      collectNames(ic.body, out);
      return out;
  }
}

function subst(ic: Ic, name: string, value: Ic): Ic {
  switch (ic.tag) {
    case "num":
      return ic;

    case "var":
      if (ic.name === name) {
        return value;
      }

      return ic;

    case "prim":
      return {
        tag: "prim",
        prim: ic.prim,
        args: ic.args.map((item) => subst(item, name, value)),
      };

    case "lam":
      if (ic.name === name) {
        return ic;
      }

      return {
        tag: "lam",
        name: ic.name,
        body: subst(ic.body, name, value),
      };

    case "app":
      return {
        tag: "app",
        func: subst(ic.func, name, value),
        arg: subst(ic.arg, name, value),
      };

    case "sup":
      return {
        tag: "sup",
        label: ic.label,
        left: subst(ic.left, name, value),
        right: subst(ic.right, name, value),
      };

    case "dup": {
      const expr = subst(ic.expr, name, value);

      if (name === `${ic.name}0` || name === `${ic.name}1`) {
        return {
          tag: "dup",
          label: ic.label,
          name: ic.name,
          expr,
          body: ic.body,
        };
      }

      return {
        tag: "dup",
        label: ic.label,
        name: ic.name,
        expr,
        body: subst(ic.body, name, value),
      };
    }

    case "era":
      return {
        tag: "era",
        expr: subst(ic.expr, name, value),
        body: subst(ic.body, name, value),
      };
  }
}

function lower(ic: Ic, env: Map<string, ValType>): ExprNode {
  switch (ic.tag) {
    case "num":
      return { tag: "num", type: ic.type, value: ic.value };

    case "var": {
      const type = env.get(ic.name);
      expect(type, "Unbound variable: " + ic.name);
      return { tag: "var", type, name: ic.name };
    }

    case "prim": {
      const expected = Prim.arity(ic.prim);
      expect(
        ic.args.length === expected,
        "Primitive " + ic.prim + " expects " + expected + " arguments",
      );

      const primType = Prim.type(ic.prim);
      const args = ic.args.map((item) => lower(item, env));

      for (let index = 0; index < args.length; index += 1) {
        const item = args[index];
        expect(item, "Missing primitive argument " + index);
        const expectedType = primType.args[index];
        expect(expectedType, "Missing primitive argument type " + index);
        const actual = Expr.type(item);
        expect(
          actual === expectedType,
          "Primitive " + ic.prim + " argument " + index + " expects " +
            expectedType + ", got " + actual,
        );
      }

      return {
        tag: "prim",
        type: primType.result,
        prim: ic.prim,
        args,
      };
    }

    case "lam":
      throw new Error("Cannot lower lambda before reduction");

    case "app":
      throw new Error("Cannot lower application before reduction");

    case "sup":
      throw new Error("Cannot lower superposition before reduction");

    case "dup": {
      const value = lower(ic.expr, env);
      const type = Expr.type(value);
      env = new Map(env);

      env.set(`${ic.name}0`, type);
      env.set(`${ic.name}1`, type);

      return {
        tag: "let",
        name: ic.name,
        value,
        body: rename(lower(ic.body, env), ic.name),
      };
    }

    case "era":
      throw new Error("Cannot lower erasure before reduction");
  }
}

function rename(expr: ExprNode, name: string): ExprNode {
  switch (expr.tag) {
    case "num":
      return expr;

    case "var":
      if (expr.name === `${name}0` || expr.name === `${name}1`) {
        return { ...expr, name };
      }

      return expr;

    case "prim":
      return {
        tag: "prim",
        type: expr.type,
        prim: expr.prim,
        args: expr.args.map((item) => rename(item, name)),
      };

    case "let":
      return {
        tag: "let",
        name: expr.name,
        value: rename(expr.value, name),
        body: rename(expr.body, name),
      };
  }
}
