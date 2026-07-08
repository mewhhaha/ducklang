import type { FrontExpr, Stmt } from "../../frontend/ast.ts";
import type { CoreExpr, CoreStmt } from "../ast.ts";
import {
  bind_core_name,
  type CoreFromSourceCtx,
  fork_core_from_source_ctx,
  resolve_core_name,
  shadow_core_name,
} from "./context.ts";
import { block_body, core_expr, core_param } from "./expr.ts";
import { validate_named_recursive_tail_binding } from "./rec.ts";

export function core_stmt(stmt: Stmt, ctx: CoreFromSourceCtx): CoreStmt {
  switch (stmt.tag) {
    case "bind": {
      if (stmt.is_recursive) {
        const name = bind_core_name(ctx, stmt.name);

        if (stmt.is_linear) {
          ctx.linear_names.add(name);
        } else {
          ctx.linear_names.delete(name);
        }

        return {
          tag: "bind",
          kind: stmt.kind,
          name,
          is_linear: stmt.is_linear,
          annotation: stmt.annotation,
          value: core_recursive_binding_value(stmt, ctx, name),
        };
      }

      const value = core_expr(stmt.value, ctx);
      const name = bind_core_name(ctx, stmt.name);

      if (stmt.is_linear) {
        ctx.linear_names.add(name);
      } else {
        ctx.linear_names.delete(name);
      }

      return {
        tag: "bind",
        kind: stmt.kind,
        name,
        is_linear: stmt.is_linear,
        annotation: stmt.annotation,
        value,
      };
    }

    case "assign": {
      const value = core_expr(stmt.value, ctx);

      if (stmt.mode === "change") {
        const name = shadow_core_name(ctx, stmt.name);
        ctx.linear_names.delete(name);
        return {
          tag: "bind",
          kind: "let",
          name,
          is_linear: false,
          annotation: undefined,
          value,
        };
      }

      return {
        tag: "assign",
        name: resolve_core_name(ctx, stmt.name),
        mode: stmt.mode,
        value,
      };
    }

    case "index_assign":
      return {
        tag: "index_assign",
        name: resolve_core_name(ctx, stmt.name),
        index: core_expr(stmt.index, ctx),
        value: core_expr(stmt.value, ctx),
      };

    case "for_range": {
      const body_ctx = fork_core_from_source_ctx(ctx);
      body_ctx.aliases.set(stmt.index, stmt.index);
      const body = stmt.body.map((item) => core_stmt(item, body_ctx));
      return {
        tag: "range_loop",
        index: stmt.index,
        start: core_expr(stmt.start, ctx),
        end: core_expr(stmt.end, ctx),
        step: core_expr(stmt.step, ctx),
        carried: carried_names(body),
        body,
      };
    }

    case "for_collection": {
      const body_ctx = fork_core_from_source_ctx(ctx);
      body_ctx.aliases.set(stmt.item, stmt.item);

      if (stmt.index) {
        body_ctx.aliases.set(stmt.index, stmt.index);
      }

      const body = stmt.body.map((item) => core_stmt(item, body_ctx));
      return {
        tag: "collection_loop",
        index: stmt.index,
        item: stmt.item,
        collection: core_expr(stmt.collection, ctx),
        carried: carried_names(body),
        body,
      };
    }

    case "if_stmt": {
      const body_ctx = fork_core_from_source_ctx(ctx);
      return {
        tag: "if_stmt",
        cond: core_expr(stmt.cond, ctx),
        body: stmt.body.map((item) => core_stmt(item, body_ctx)),
      };
    }

    case "if_let_stmt": {
      const body_ctx = fork_core_from_source_ctx(ctx);

      if (stmt.value_name) {
        body_ctx.aliases.set(stmt.value_name, stmt.value_name);
      }

      return {
        tag: "if_let_stmt",
        case_name: stmt.case_name,
        value_name: stmt.value_name,
        target: core_expr(stmt.target, ctx),
        body: stmt.body.map((item) => core_stmt(item, body_ctx)),
      };
    }

    case "type_check":
      return {
        tag: "type_check",
        pattern: stmt.pattern,
        target: core_expr(stmt.target, ctx),
      };

    case "break":
      return { tag: "break" };

    case "continue":
      return { tag: "continue" };

    case "return":
      return { tag: "return", value: core_expr(stmt.value, ctx) };

    case "expr": {
      const if_else = core_if_else_stmt(stmt.expr, ctx);

      if (if_else) {
        return if_else;
      }

      return { tag: "expr", expr: core_expr(stmt.expr, ctx) };
    }

    case "import":
      return {
        tag: "unsupported",
        feature: "import",
        text: stmt.name + " from " + Deno.inspect(stmt.path),
      };

    case "host_import":
      return {
        tag: "unsupported",
        feature: "host_import",
        text: stmt.value.name,
      };

    case "unsupported":
      return {
        tag: "unsupported",
        feature: stmt.feature,
        text: stmt.text,
      };
  }
}

function core_recursive_binding_value(
  stmt: Extract<Stmt, { tag: "bind" }>,
  ctx: CoreFromSourceCtx,
  name: string,
): CoreExpr {
  if (stmt.value.tag === "rec") {
    const body_ctx = fork_core_from_source_ctx(ctx);

    for (const param of stmt.value.params) {
      body_ctx.aliases.set(param.name, param.name);
      if (param.is_linear) {
        body_ctx.linear_names.add(param.name);
      } else {
        body_ctx.linear_names.delete(param.name);
      }
    }

    return {
      tag: "rec",
      params: stmt.value.params.map(core_param),
      body: core_expr(stmt.value.body, body_ctx),
    };
  }

  if (stmt.value.tag !== "lam") {
    throw new Error("Cannot lower recursive source binding to Core yet");
  }

  const params = stmt.value.params.map(core_param);
  let is_tail = true;

  try {
    validate_named_recursive_tail_binding(stmt.name, stmt.value);
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error;
    }

    if (error.message !== "Cannot lower recursive source binding to Core yet") {
      throw error;
    }

    is_tail = false;
  }

  if (!is_tail) {
    ctx.namedRecs.set(name, { params, body: undefined });
  }

  const body_ctx = fork_core_from_source_ctx(ctx);

  if (is_tail) {
    body_ctx.aliases.set(stmt.name, "rec");
  } else {
    body_ctx.aliases.set(stmt.name, name);
    body_ctx.namedRecs.set(name, { params, body: undefined });
  }

  for (const param of stmt.value.params) {
    body_ctx.aliases.set(param.name, param.name);
    if (param.is_linear) {
      body_ctx.linear_names.add(param.name);
    } else {
      body_ctx.linear_names.delete(param.name);
    }
  }

  const body = core_expr(stmt.value.body, body_ctx);

  if (!is_tail) {
    ctx.namedRecs.set(name, { params, body });
    return { tag: "rec_ref", name, params };
  }

  return { tag: "rec", params, body };
}

function carried_names(stmts: CoreStmt[]): string[] {
  const names: string[] = [];

  function add(name: string): void {
    if (!names.includes(name)) {
      names.push(name);
    }
  }

  function visit(stmt: CoreStmt): void {
    switch (stmt.tag) {
      case "assign":
      case "index_assign":
        add(stmt.name);
        return;

      case "range_loop":
      case "collection_loop":
        for (const name of stmt.carried) {
          add(name);
        }

        return;

      case "if_stmt":
      case "if_let_stmt":
        for (const item of stmt.body) {
          visit(item);
        }

        return;

      case "if_else_stmt":
        for (const item of stmt.then_body) {
          visit(item);
        }

        for (const item of stmt.else_body) {
          visit(item);
        }

        return;

      case "bind":
      case "type_check":
      case "break":
      case "continue":
      case "return":
      case "expr":
      case "unsupported":
        return;
    }
  }

  for (const stmt of stmts) {
    visit(stmt);
  }

  return names;
}

function core_if_else_stmt(
  expr: FrontExpr,
  ctx: CoreFromSourceCtx,
): CoreStmt | undefined {
  if (expr.tag !== "if") {
    return undefined;
  }

  const then_body = block_body(expr.then_branch);
  const else_body = block_body(expr.else_branch);

  if (!then_body || !else_body) {
    return undefined;
  }

  if (block_produces_value(then_body) && block_produces_value(else_body)) {
    return undefined;
  }

  const then_ctx = fork_core_from_source_ctx(ctx);
  const else_ctx = fork_core_from_source_ctx(ctx);

  return {
    tag: "if_else_stmt",
    cond: core_expr(expr.cond, ctx),
    then_body: then_body.map((stmt) => core_stmt(stmt, then_ctx)),
    else_body: else_body.map((stmt) => core_stmt(stmt, else_ctx)),
  };
}

function block_produces_value(stmts: Stmt[]): boolean {
  const stmt = stmts[stmts.length - 1];

  if (!stmt) {
    return false;
  }

  if (stmt.tag === "expr") {
    return true;
  }

  if (stmt.tag === "return") {
    return true;
  }

  return false;
}
