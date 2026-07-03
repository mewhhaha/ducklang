import { expect } from "../expect.ts";
import type { FrontExpr, Stmt } from "./ast.ts";

export type LinearClosureEnv = Map<string, Extract<FrontExpr, { tag: "lam" }>>;

export function clone_linear_closures(
  closures: LinearClosureEnv,
): LinearClosureEnv {
  return new Map(closures);
}

export function bind_linear_closure(
  closures: LinearClosureEnv,
  name: string,
  value: FrontExpr,
  available: Set<string>,
): void {
  if (available.has(name)) {
    closures.delete(name);
    return;
  }

  const closure = resolve_linear_closure_expr(value, closures);

  if (closure) {
    closures.set(name, closure);
    return;
  }

  closures.delete(name);
}

export function resolve_linear_closure_expr(
  value: FrontExpr,
  closures: LinearClosureEnv,
): Extract<FrontExpr, { tag: "lam" }> | undefined {
  const unwrapped = unwrap_linear_closure_value(value);

  if (unwrapped.tag === "lam") {
    return unwrapped;
  }

  if (unwrapped.tag === "if") {
    const branch = static_if_branch(unwrapped);

    if (branch) {
      return resolve_linear_closure_expr(branch, closures);
    }
  }

  if (unwrapped.tag === "var") {
    return closures.get(unwrapped.name);
  }

  return undefined;
}

function unwrap_linear_closure_value(value: FrontExpr): FrontExpr {
  if (value.tag !== "block" || value.statements.length !== 1) {
    if (value.tag === "block") {
      const unwrapped = unwrap_simple_linear_closure_block(value.statements);

      if (unwrapped) {
        return unwrapped;
      }
    }

    return value;
  }

  const stmt = value.statements[0];
  expect(stmt, "Missing linear closure block statement");

  if (stmt.tag === "expr") {
    return stmt.expr;
  }

  if (stmt.tag === "return") {
    return stmt.value;
  }

  return value;
}

function unwrap_simple_linear_closure_block(
  stmts: Stmt[],
): FrontExpr | undefined {
  const local = new Map<string, FrontExpr>();

  for (let index = 0; index < stmts.length; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing linear closure block statement " + index.toString());

    if (stmt.tag === "bind") {
      if (stmt.is_linear) {
        return undefined;
      }

      local.set(
        stmt.name,
        unwrap_local_linear_closure_value(stmt.value, local),
      );
      continue;
    }

    if (stmt.tag === "assign") {
      local.set(
        stmt.name,
        unwrap_local_linear_closure_value(stmt.value, local),
      );
      continue;
    }

    if (stmt.tag === "expr") {
      return unwrap_local_linear_closure_value(stmt.expr, local);
    }

    if (stmt.tag === "return") {
      return unwrap_local_linear_closure_value(stmt.value, local);
    }

    return undefined;
  }

  return undefined;
}

function unwrap_local_linear_closure_value(
  value: FrontExpr,
  local: Map<string, FrontExpr>,
): FrontExpr {
  const unwrapped = unwrap_linear_closure_value(value);

  if (unwrapped.tag === "var") {
    const local_value = local.get(unwrapped.name);

    if (local_value) {
      return local_value;
    }
  }

  return unwrapped;
}

function static_if_branch(
  value: Extract<FrontExpr, { tag: "if" }>,
): FrontExpr | undefined {
  if (value.cond.tag !== "num") {
    return undefined;
  }

  if (value.cond.type !== "i32") {
    return undefined;
  }

  const cond = value.cond.value;
  expect(typeof cond === "number", "Expected i32 static if condition");

  if (cond !== 0) {
    return value.then_branch;
  }

  return value.else_branch;
}
