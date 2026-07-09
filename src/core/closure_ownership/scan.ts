import type { CoreExpr, CoreStmt } from "../ast.ts";
import { align_to, val_type_align, val_type_size } from "../memory.ts";
import { core_expr_ownership, type CoreOwnership } from "../ownership.ts";
import type { CoreCaptureInfo } from "../closure_capture.ts";
import {
  closure_capture_decision,
  merge_closure_capture_decisions,
} from "./decision.ts";
import {
  clone_closure_ownership_facts,
  record_closure_local_ownership_fact,
  try_capture_ownership,
} from "./facts.ts";
import type {
  CoreClosureCaptureSlot,
  CoreClosureOwnershipCtx,
  CoreClosureOwnershipEdge,
  CoreClosureOwnershipFacts,
  CoreClosureOwnershipHooks,
  CoreClosureOwnershipState,
} from "./types.ts";

export function scan_closure_ownership_stmts<
  ctx extends CoreClosureOwnershipCtx,
>(
  statements: CoreStmt[],
  scope: string,
  ctx: ctx,
  facts: CoreClosureOwnershipFacts,
  hooks: CoreClosureOwnershipHooks<ctx>,
  state: CoreClosureOwnershipState,
): void {
  for (const stmt of statements) {
    scan_closure_ownership_stmt(stmt, scope, ctx, facts, hooks, state);
  }
}

function scan_closure_ownership_stmt<ctx extends CoreClosureOwnershipCtx>(
  stmt: CoreStmt,
  scope: string,
  ctx: ctx,
  facts: CoreClosureOwnershipFacts,
  hooks: CoreClosureOwnershipHooks<ctx>,
  state: CoreClosureOwnershipState,
): void {
  switch (stmt.tag) {
    case "bind":
    case "assign":
      scan_closure_ownership_expr(stmt.value, scope, ctx, facts, hooks, state);
      record_closure_local_ownership_fact(
        stmt.name,
        stmt.value,
        ctx,
        facts,
        hooks,
      );
      if (stmt.tag === "bind") {
        if (stmt.is_linear) {
          facts.linear_names.add(stmt.name);
        } else {
          facts.linear_names.delete(stmt.name);
          facts.linear_ownerships.delete(stmt.name);
        }
      }
      try_collect_stmt_locals(stmt, ctx, hooks);
      if (stmt.tag === "bind" && stmt.is_linear) {
        const ownership = try_capture_ownership_from_value(
          { tag: "var", name: stmt.name },
          ctx,
          hooks,
        );

        if (ownership) {
          facts.linear_ownerships.set(stmt.name, ownership);
        }
      }
      return;

    case "index_assign":
      scan_closure_ownership_expr(stmt.index, scope, ctx, facts, hooks, state);
      scan_closure_ownership_expr(stmt.value, scope, ctx, facts, hooks, state);
      try_collect_stmt_locals(stmt, ctx, hooks);
      return;

    case "range_loop": {
      scan_closure_ownership_expr(stmt.start, scope, ctx, facts, hooks, state);
      scan_closure_ownership_expr(stmt.end, scope, ctx, facts, hooks, state);
      scan_closure_ownership_expr(stmt.step, scope, ctx, facts, hooks, state);
      const body_ctx = hooks.block_ctx(ctx);
      try_collect_stmt_locals(stmt, ctx, hooks);
      scan_closure_ownership_stmts(
        stmt.body,
        scope,
        body_ctx,
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      return;
    }

    case "collection_loop": {
      scan_closure_ownership_expr(
        stmt.collection,
        scope,
        ctx,
        facts,
        hooks,
        state,
      );
      const body_ctx = hooks.block_ctx(ctx);
      try_collect_stmt_locals(stmt, ctx, hooks);
      scan_closure_ownership_stmts(
        stmt.body,
        scope,
        body_ctx,
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      return;
    }

    case "if_stmt": {
      scan_closure_ownership_expr(stmt.cond, scope, ctx, facts, hooks, state);
      const body_ctx = hooks.block_ctx(ctx);
      scan_closure_ownership_stmts(
        stmt.body,
        scope,
        body_ctx,
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      try_collect_stmt_locals(stmt, ctx, hooks);
      return;
    }

    case "if_else_stmt": {
      scan_closure_ownership_expr(stmt.cond, scope, ctx, facts, hooks, state);
      scan_closure_ownership_stmts(
        stmt.then_body,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      scan_closure_ownership_stmts(
        stmt.else_body,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      try_collect_stmt_locals(stmt, ctx, hooks);
      return;
    }

    case "if_let_stmt": {
      scan_closure_ownership_expr(stmt.target, scope, ctx, facts, hooks, state);
      scan_closure_ownership_stmts(
        stmt.body,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      try_collect_stmt_locals(stmt, ctx, hooks);
      return;
    }

    case "type_check":
      scan_closure_ownership_expr(stmt.target, scope, ctx, facts, hooks, state);
      return;

    case "return":
      scan_closure_ownership_expr(stmt.value, scope, ctx, facts, hooks, state);
      return;

    case "expr":
      scan_closure_ownership_expr(stmt.expr, scope, ctx, facts, hooks, state);
      return;

    case "break":
    case "continue":
    case "unsupported":
      return;
  }
}

function try_capture_ownership_from_value<
  ctx extends CoreClosureOwnershipCtx,
>(
  value: CoreExpr,
  ctx: ctx,
  hooks: CoreClosureOwnershipHooks<ctx>,
): CoreOwnership | undefined {
  try {
    return core_expr_ownership(value, ctx, hooks);
  } catch {
    return undefined;
  }
}

function scan_closure_ownership_expr<ctx extends CoreClosureOwnershipCtx>(
  expr: CoreExpr,
  scope: string,
  ctx: ctx,
  facts: CoreClosureOwnershipFacts,
  hooks: CoreClosureOwnershipHooks<ctx>,
  state: CoreClosureOwnershipState,
): void {
  switch (expr.tag) {
    case "num":
    case "text":
    case "type_name":
    case "linear":
    case "struct_type":
    case "union_type":
    case "unsupported":
      return;

    case "var":
      return;

    case "lam":
    case "rec":
      record_closure_ownership_edge(expr, scope, ctx, facts, hooks, state);
      return;

    case "prim":
      for (const arg of expr.args) {
        scan_closure_ownership_expr(arg, scope, ctx, facts, hooks, state);
      }
      return;

    case "app":
      {
        const func_facts = clone_closure_ownership_facts(facts);

        if (expr.func.tag === "lam" || expr.func.tag === "rec") {
          func_facts.direct_call_depth += 1;
        }

        scan_closure_ownership_expr(
          expr.func,
          scope,
          ctx,
          func_facts,
          hooks,
          state,
        );
      }
      for (const arg of expr.args) {
        scan_closure_ownership_expr(arg, scope, ctx, facts, hooks, state);
      }
      return;

    case "block": {
      const block_ctx = hooks.block_ctx(ctx);
      const block_scope = scope + "/block#" + state.next_block.toString();
      state.next_block += 1;
      scan_closure_ownership_stmts(
        expr.statements,
        block_scope,
        block_ctx,
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      return;
    }

    case "comptime":
      scan_closure_ownership_expr(expr.expr, scope, ctx, facts, hooks, state);
      return;

    case "borrow":
    case "freeze":
      scan_closure_ownership_expr(expr.value, scope, ctx, facts, hooks, state);
      return;

    case "scratch": {
      const scratch_facts = clone_closure_ownership_facts(facts);
      scratch_facts.scratch_depth += 1;
      scan_closure_ownership_expr(
        expr.body,
        scope,
        ctx,
        scratch_facts,
        hooks,
        state,
      );
      return;
    }

    case "with":
      scan_closure_ownership_expr(expr.base, scope, ctx, facts, hooks, state);
      scan_closure_ownership_fields(
        expr.fields,
        scope,
        ctx,
        facts,
        hooks,
        state,
      );
      return;

    case "struct_value":
      scan_closure_ownership_expr(
        expr.type_expr,
        scope,
        ctx,
        facts,
        hooks,
        state,
      );
      scan_closure_ownership_fields(
        expr.fields,
        scope,
        ctx,
        facts,
        hooks,
        state,
      );
      return;

    case "struct_update":
      scan_closure_ownership_expr(expr.base, scope, ctx, facts, hooks, state);
      scan_closure_ownership_fields(
        expr.fields,
        scope,
        ctx,
        facts,
        hooks,
        state,
      );
      return;

    case "if":
      scan_closure_ownership_expr(expr.cond, scope, ctx, facts, hooks, state);
      scan_closure_ownership_expr(
        expr.then_branch,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      scan_closure_ownership_expr(
        expr.else_branch,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      return;

    case "if_let":
      scan_closure_ownership_expr(expr.target, scope, ctx, facts, hooks, state);
      scan_closure_ownership_expr(
        expr.then_branch,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      scan_closure_ownership_expr(
        expr.else_branch,
        scope,
        hooks.block_ctx(ctx),
        clone_closure_ownership_facts(facts),
        hooks,
        state,
      );
      return;

    case "field":
      scan_closure_ownership_expr(expr.object, scope, ctx, facts, hooks, state);
      return;

    case "index":
      scan_closure_ownership_expr(
        expr.object,
        scope,
        ctx,
        facts,
        hooks,
        state,
      );
      scan_closure_ownership_expr(expr.index, scope, ctx, facts, hooks, state);
      return;

    case "union_case":
      if (expr.value) {
        scan_closure_ownership_expr(
          expr.value,
          scope,
          ctx,
          facts,
          hooks,
          state,
        );
      }
      if (expr.type_expr) {
        scan_closure_ownership_expr(
          expr.type_expr,
          scope,
          ctx,
          facts,
          hooks,
          state,
        );
      }
      return;
  }
}

function record_closure_ownership_edge<ctx extends CoreClosureOwnershipCtx>(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
  scope: string,
  ctx: ctx,
  facts: CoreClosureOwnershipFacts,
  hooks: CoreClosureOwnershipHooks<ctx>,
  state: CoreClosureOwnershipState,
): void {
  const capture_expr = lam_capture_expr(expr);
  const info = try_lam_capture_info(capture_expr, ctx, hooks);

  if (!info) {
    return;
  }

  const captures: CoreClosureCaptureSlot[] = [];
  let offset = 4;
  let linear = false;
  let persistent_environment = false;

  const capture_names = [...info.names];

  if (
    expr.body.tag === "linear" &&
    facts.linear_names.has(expr.body.name) &&
    !capture_names.includes(expr.body.name)
  ) {
    capture_names.push(expr.body.name);
  }

  for (const name of capture_names) {
    const ownership = try_capture_ownership(name, ctx, facts, hooks);

    if (!ownership) {
      continue;
    }

    const type = ownership.tag === "scalar_local" ? ownership.type : "i32";
    offset = align_to(offset, val_type_align(type));
    const is_linear = facts.linear_names.has(name);
    let environment:
      | CoreClosureCaptureSlot["environment"]
      | undefined;

    if (is_linear) {
      linear = true;
      environment = {
        offset,
        storage: "unique_heap",
        lifetime: "persistent",
        transfer: "move",
      };
    } else if (
      facts.scratch_depth > 0 && ownership.tag === "frozen_shareable"
    ) {
      persistent_environment = true;
      environment = {
        offset,
        storage: "unique_heap",
        lifetime: "persistent",
        transfer: "share",
      };
    }

    const capture: CoreClosureCaptureSlot = {
      name,
      ownership,
      decision: closure_capture_decision(ownership, expr, facts, is_linear),
    };
    if (environment) {
      capture.environment = environment;
    }
    captures.push(capture);
    offset += val_type_size(type);
  }

  if (captures.length === 0) {
    return;
  }

  const edge: CoreClosureOwnershipEdge = {
    id: "closure_capture#" + state.edges.length.toString(),
    scope,
    expression: expr.tag,
    captures,
    decision: merge_closure_capture_decisions(captures),
  };
  if (linear) {
    edge.callable = "once";
    edge.environment_storage = "persistent_unique_heap";
  } else if (persistent_environment) {
    edge.environment_storage = "persistent_unique_heap";
  }
  state.edges.push(edge);
}

function lam_capture_expr(
  expr: Extract<CoreExpr, { tag: "lam" | "rec" }>,
): Extract<CoreExpr, { tag: "lam" }> {
  if (expr.tag === "lam") {
    return expr;
  }

  return {
    tag: "lam",
    params: expr.params,
    body: expr.body,
  };
}

function scan_closure_ownership_fields<ctx extends CoreClosureOwnershipCtx>(
  fields: { value: CoreExpr }[],
  scope: string,
  ctx: ctx,
  facts: CoreClosureOwnershipFacts,
  hooks: CoreClosureOwnershipHooks<ctx>,
  state: CoreClosureOwnershipState,
): void {
  for (const field of fields) {
    scan_closure_ownership_expr(
      field.value,
      scope,
      ctx,
      facts,
      hooks,
      state,
    );
  }
}

function try_collect_stmt_locals<ctx extends CoreClosureOwnershipCtx>(
  stmt: CoreStmt,
  ctx: ctx,
  hooks: CoreClosureOwnershipHooks<ctx>,
): void {
  try {
    hooks.collect_stmt_locals(stmt, ctx);
  } catch {
    return;
  }
}

function try_lam_capture_info<ctx extends CoreClosureOwnershipCtx>(
  expr: Extract<CoreExpr, { tag: "lam" }>,
  ctx: ctx,
  hooks: CoreClosureOwnershipHooks<ctx>,
): CoreCaptureInfo | undefined {
  try {
    return hooks.core_lam_capture_info(expr, ctx);
  } catch {
    return undefined;
  }
}
