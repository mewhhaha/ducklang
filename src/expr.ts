export type Expr =
  | { tag: "num"; value: number }
  | { tag: "var"; name: string }
  | { tag: "add"; left: Expr; right: Expr }
  | { tag: "let"; name: string; value: Expr; body: Expr };

export function Expr() {}

// Collect all local variables into a set
function collect(expr: Expr, out = new Set<string>()): Set<string> {
  if (expr.tag === "num" || expr.tag === "var") {
    return out;
  }

  if (expr.tag === "add") {
    collect(expr.left, out);
    collect(expr.right, out);
    return out;
  }

  if (expr.tag === "let") {
    out.add(expr.name);
    collect(expr.value, out);
    collect(expr.body, out);
    return out;
  }

  expr satisfies never;
  throw new Error("panic");
}

function _emit(expr: Expr, env: Map<string, string>): string {
  if (expr.tag === "num") {
    return `i32.const ${expr.value}`;
  }

  if (expr.tag === "var") {
    const local = env.get(expr.name);

    if (local === undefined) {
      throw new Error(`Unbound variable: ${expr.name}`);
    }

    return `local.get $${local}`;
  }

  if (expr.tag === "add") {
    return `
${_emit(expr.left, env)}
${_emit(expr.right, env)}
i32.add
    `.trim();
  }

  if (expr.tag === "let") {
    const nextEnv = new Map(env);
    nextEnv.set(expr.name, expr.name);

    return `
${_emit(expr.value, env)}
local.set $${expr.name}
${_emit(expr.body, nextEnv)}
    `.trim();
  }

  expr satisfies never;
  throw new Error("panic");
}

Expr.emit = function emit(expr: Expr): string {
  const locals = [...collect(expr)]
    .map((name) => `(local $${name} i32)`)
    .join("\n");

  const body = _emit(expr, new Map());

  if (locals.length === 0) {
    return body;
  }

  return `${locals}\n${body}`;
};

Expr.fmt = function fmt(expr: Expr): string {
  if (expr.tag === "num") {
    return expr.value.toString();
  }

  if (expr.tag === "var") {
    return expr.name;
  }

  if (expr.tag === "add") {
    const left = fmt(expr.left);
    const right = fmt(expr.right);
    return `(${left} + ${right})`;
  }

  if (expr.tag === "let") {
    const value = fmt(expr.value);
    const body = fmt(expr.body);
    return `let ${expr.name} = ${value};\n${body}`;
  }

  expr satisfies never;
  throw new Error("panic");
};
