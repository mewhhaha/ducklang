import type { CoreExpr, CoreField, CoreStmt } from "../ast.ts";
import { scan_allocation_block } from "./block.ts";
import { scan_closure_body_allocations } from "./closure.ts";
import {
  freeze_copies_runtime_aggregate,
  freeze_copies_runtime_union,
  freeze_promotes_runtime_aggregate,
  freeze_promotes_runtime_closure,
  freeze_promotes_runtime_text,
  freeze_promotes_runtime_union,
  record_runtime_aggregate_freeze_copy_allocations,
  record_runtime_union_freeze_copy_allocations,
} from "./freeze.ts";
import {
  scan_allocation_if_let_expr,
  scan_allocation_if_let_stmt,
} from "./if_let.ts";
import { core_expr_ownership } from "../ownership.ts";
import { runtime_aggregate_layout } from "../runtime_aggregate.ts";
import { static_type_value, type TypeStaticCtx } from "../type_static.ts";
import { record_allocation } from "./record.ts";
import { record_runtime_union_allocations } from "./runtime_union.ts";
import {
  allocation_stmt_value_is_scoped_static_call_target,
  scoped_static_allocation_call_value,
} from "./static_call.ts";
import {
  scan_static_value_allocation_expr,
  static_value_materializes_runtime_union_owner,
} from "./static_value.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationScope,
  CoreAllocationState,
} from "./types.ts";

export function scan_allocation_stmts<ctx>(
  statements: CoreStmt[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  for (const stmt of statements) {
    scan_allocation_stmt(stmt, scope, ctx, hooks, state);
  }
}

function scan_allocation_scoped_stmts<ctx>(
  statements: CoreStmt[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_allocation_stmts(statements, scope, ctx, hooks, state);
    return;
  }

  const scoped_ctx = hooks.block_ctx(ctx);

  for (let index = 0; index < statements.length; index += 1) {
    const stmt = statements[index];

    if (!stmt) {
      throw new Error("Missing allocation scoped statement");
    }

    scan_allocation_stmt(stmt, scope, scoped_ctx, hooks, state);

    if (index + 1 < statements.length) {
      hooks.collect_stmt_locals(stmt, scoped_ctx);
    }
  }
}

function scan_allocation_stmt<ctx>(
  stmt: CoreStmt,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  switch (stmt.tag) {
    case "bind": {
      const allocation_start = state.facts.length;
      if (
        allocation_stmt_value_is_scoped_static_call_target(stmt, ctx, hooks)
      ) {
        return;
      }

      if (hooks.is_static_value_expr(stmt.value, ctx)) {
        scan_static_value_allocation_expr(
          stmt.value,
          scope,
          ctx,
          hooks,
          state,
          static_value_materializes_runtime_union_owner(
            stmt.value,
            !!stmt.annotation,
            ctx,
            hooks,
          ),
          scan_allocation_expr,
          scan_allocation_fields,
        );
        mark_bound_allocation_owner(state, allocation_start, stmt.name);
        return;
      }

      scan_allocation_expr(stmt.value, scope, ctx, hooks, state);
      mark_bound_allocation_owner(state, allocation_start, stmt.name);
      record_closure_call_result_allocation(
        stmt.value,
        stmt.name,
        scope,
        ctx,
        hooks,
        state,
      );
      return;
    }

    case "assign": {
      const allocation_start = state.facts.length;
      if (
        allocation_stmt_value_is_scoped_static_call_target(stmt, ctx, hooks)
      ) {
        return;
      }

      if (hooks.is_static_value_expr(stmt.value, ctx)) {
        scan_static_value_allocation_expr(
          stmt.value,
          scope,
          ctx,
          hooks,
          state,
          static_value_materializes_runtime_union_owner(
            stmt.value,
            false,
            ctx,
            hooks,
          ),
          scan_allocation_expr,
          scan_allocation_fields,
        );
        mark_bound_allocation_owner(state, allocation_start, stmt.name);
        return;
      }

      scan_allocation_expr(stmt.value, scope, ctx, hooks, state);
      mark_bound_allocation_owner(state, allocation_start, stmt.name);
      record_closure_call_result_allocation(
        stmt.value,
        stmt.name,
        scope,
        ctx,
        hooks,
        state,
      );
      return;
    }

    case "index_assign":
      scan_allocation_expr(stmt.index, scope, ctx, hooks, state);
      scan_allocation_expr(stmt.value, scope, ctx, hooks, state);
      return;

    case "range_loop":
      scan_allocation_expr(stmt.start, scope, ctx, hooks, state);
      scan_allocation_expr(stmt.end, scope, ctx, hooks, state);
      scan_allocation_expr(stmt.step, scope, ctx, hooks, state);
      scan_allocation_loop_stmts(stmt, scope, ctx, hooks, state);
      return;

    case "collection_loop":
      scan_allocation_expr(stmt.collection, scope, ctx, hooks, state);
      scan_allocation_loop_stmts(stmt, scope, ctx, hooks, state);
      return;

    case "if_stmt":
      scan_allocation_expr(stmt.cond, scope, ctx, hooks, state);
      scan_allocation_scoped_stmts(stmt.body, scope, ctx, hooks, state);
      return;

    case "if_else_stmt":
      scan_allocation_expr(stmt.cond, scope, ctx, hooks, state);
      scan_allocation_scoped_stmts(
        stmt.then_body,
        scope,
        ctx,
        hooks,
        state,
      );
      scan_allocation_scoped_stmts(
        stmt.else_body,
        scope,
        ctx,
        hooks,
        state,
      );
      return;

    case "if_let_stmt":
      scan_allocation_if_let_stmt(
        stmt,
        scope,
        ctx,
        hooks,
        state,
        scan_allocation_expr,
        scan_allocation_scoped_stmts,
      );
      return;

    case "type_check":
      scan_allocation_expr(stmt.target, scope, ctx, hooks, state);
      return;

    case "return":
      scan_allocation_expr(stmt.value, scope, ctx, hooks, state);
      return;

    case "expr":
      scan_allocation_expr(stmt.expr, scope, ctx, hooks, state);
      return;

    case "break":
      if (stmt.value) {
        scan_allocation_expr(stmt.value, scope, ctx, hooks, state);
      }
      return;
    case "continue":
    case "unsupported":
      return;
  }
}

function scan_allocation_loop_stmts<ctx>(
  stmt: Extract<CoreStmt, { tag: "range_loop" | "collection_loop" }>,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  if (!hooks.block_ctx || !hooks.collect_stmt_locals) {
    scan_allocation_stmts(stmt.body, scope, ctx, hooks, state);
    return;
  }

  const loop_ctx = hooks.block_ctx(ctx);
  hooks.collect_stmt_locals(stmt, loop_ctx);
  scan_allocation_stmts(stmt.body, scope, loop_ctx, hooks, state);
}

function mark_bound_allocation_owner(
  state: CoreAllocationState,
  start: number,
  owner: string,
): void {
  for (let index = start; index < state.facts.length; index += 1) {
    const fact = state.facts[index];
    if (!fact) {
      continue;
    }

    if (fact.owner) {
      continue;
    }

    fact.owner = owner;
  }
}

function record_closure_call_result_allocation<ctx>(
  value: CoreExpr,
  owner: string,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  if (value.tag !== "app") {
    return;
  }

  let fn_type;

  try {
    fn_type = hooks.closure_fn_type(value.func, ctx);
  } catch {
    return;
  }

  if (!fn_type) {
    return;
  }

  let ownership;

  try {
    ownership = core_expr_ownership(value, ctx, hooks);
  } catch {
    return;
  }

  if (ownership.tag !== "unique_heap") {
    return;
  }

  let reason:
    | "closure"
    | "runtime_aggregate"
    | "runtime_text"
    | "runtime_union";

  if (ownership.reason === "closure") {
    reason = "closure";
  } else if (ownership.reason === "runtime_aggregate") {
    reason = "runtime_aggregate";
  } else if (ownership.reason === "runtime_union") {
    reason = "runtime_union";
  } else {
    reason = "runtime_text";
  }

  const start = state.facts.length;
  record_allocation(value, reason, scope, state);
  mark_bound_allocation_owner(state, start, owner);
}

function scan_allocation_expr<ctx>(
  expr: CoreExpr,
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
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

    case "var": {
      if (hooks.static_text_value(expr, ctx)) {
        return;
      }

      const union_value = hooks.runtime_union_value(expr, ctx);
      if (union_value) {
        record_runtime_union_allocations(
          union_value,
          scope,
          ctx,
          hooks,
          state,
          scan_allocation_expr,
        );
        return;
      }

      if (hooks.static_struct_value(expr, ctx)) {
        record_allocation(expr, "runtime_aggregate", scope, state);
      }

      return;
    }

    case "lam":
    case "rec": {
      if (hooks.closure_fn_type(expr, ctx)) {
        record_allocation(expr, "closure", scope, state);
        scan_closure_body_allocations(
          expr,
          scope,
          ctx,
          hooks,
          state,
          scan_allocation_expr,
        );
      }

      return;
    }

    case "prim":
      for (const arg of expr.args) {
        scan_allocation_expr(arg, scope, ctx, hooks, state);
      }

      if (hooks.is_runtime_text_concat(expr, ctx)) {
        record_allocation(expr, "runtime_text", scope, state);
      }

      return;

    case "app": {
      if (
        expr.func.tag === "var" &&
        (expr.func.name === "runtime_i32_slice" ||
          expr.func.name === "runtime_text_slice")
      ) {
        for (const arg of expr.args) {
          scan_allocation_expr(arg, scope, ctx, hooks, state);
        }
        record_allocation(expr, "runtime_aggregate", scope, state);
        return;
      }

      const union_value = hooks.runtime_union_value(expr, ctx);
      if (union_value) {
        record_runtime_union_allocations(
          union_value,
          scope,
          ctx,
          hooks,
          state,
          scan_allocation_expr,
        );
        return;
      }

      const inlined = hooks.static_core_call_value(expr, ctx);
      if (inlined) {
        scan_allocation_expr(inlined, scope, ctx, hooks, state);
        return;
      }

      const scoped = scoped_static_allocation_call_value(expr, ctx, hooks);

      if (scoped) {
        scan_allocation_expr(expr.func, scope, ctx, hooks, state);

        for (const arg of expr.args) {
          scan_allocation_expr(arg, scope, ctx, hooks, state);
        }

        scan_allocation_expr(scoped.value, scope, scoped.ctx, hooks, state);
        return;
      }

      scan_allocation_expr(expr.func, scope, ctx, hooks, state);
      for (const arg of expr.args) {
        scan_allocation_expr(arg, scope, ctx, hooks, state);
      }

      if (hooks.host_import_result_ownership) {
        const result = hooks.host_import_result_ownership(expr, ctx);

        if (result && result.tag === "unique_heap") {
          let reason:
            | "closure"
            | "runtime_aggregate"
            | "runtime_text"
            | "runtime_union";

          if (result.reason === "closure") {
            reason = "closure";
          } else if (result.reason === "runtime_aggregate") {
            reason = "runtime_aggregate";
          } else if (result.reason === "runtime_union") {
            reason = "runtime_union";
          } else {
            reason = "runtime_text";
          }

          record_allocation(expr, reason, scope, state);
        }
      }

      if (expr.func.tag === "var" && expr.func.name === "slice") {
        record_allocation(expr, "runtime_text", scope, state);
      }

      if (
        expr.func.tag === "var" && expr.func.name === "append" &&
        !hooks.closure_fn_type(expr.func, ctx)
      ) {
        record_allocation(expr, "runtime_text", scope, state);
      }

      return;
    }

    case "block": {
      const block = "block#" + state.next_block.toString();
      state.next_block += 1;
      scan_allocation_block(
        expr,
        { name: block, scratch: scope.scratch },
        ctx,
        hooks,
        state,
        scan_allocation_stmt,
        scan_allocation_stmts,
      );
      return;
    }

    case "loop": {
      const loop = "loop#" + state.next_block.toString();
      state.next_block += 1;
      scan_allocation_scoped_stmts(
        expr.body,
        { name: loop, scratch: scope.scratch },
        ctx,
        hooks,
        state,
      );
      return;
    }

    case "comptime":
      scan_allocation_expr(expr.expr, scope, ctx, hooks, state);
      return;

    case "borrow":
      scan_allocation_expr(expr.value, scope, ctx, hooks, state);
      return;

    case "freeze": {
      if (freeze_promotes_runtime_text(expr, ctx, hooks)) {
        scan_allocation_expr(expr.value, scope, ctx, hooks, state);

        if (scope.scratch) {
          record_allocation(
            expr,
            "runtime_text",
            { name: scope.name, scratch: undefined },
            state,
          );
        }

        return;
      }

      if (freeze_promotes_runtime_closure(expr, ctx, hooks)) {
        scan_allocation_expr(
          expr.value,
          { name: scope.name, scratch: undefined },
          ctx,
          hooks,
          state,
        );
        return;
      }

      if (freeze_promotes_runtime_aggregate(expr, ctx, hooks)) {
        scan_allocation_expr(
          expr.value,
          { name: scope.name, scratch: undefined },
          ctx,
          hooks,
          state,
        );
        return;
      }

      if (freeze_copies_runtime_aggregate(expr, ctx, hooks)) {
        record_runtime_aggregate_freeze_copy_allocations(
          expr,
          { name: scope.name, scratch: undefined },
          ctx,
          hooks,
          state,
        );
        return;
      }

      if (freeze_promotes_runtime_union(expr, ctx, hooks)) {
        scan_allocation_expr(
          expr.value,
          { name: scope.name, scratch: undefined },
          ctx,
          hooks,
          state,
        );
        return;
      }

      if (freeze_copies_runtime_union(expr, ctx, hooks)) {
        if (expr.value.tag !== "var") {
          scan_allocation_expr(expr.value, scope, ctx, hooks, state);
        }

        record_runtime_union_freeze_copy_allocations(
          expr,
          { name: scope.name, scratch: undefined },
          ctx,
          hooks,
          state,
        );
        return;
      }

      scan_allocation_expr(expr.value, scope, ctx, hooks, state);
      return;
    }

    case "scratch": {
      const scratch = "scratch#" + state.next_scratch.toString();
      state.next_scratch += 1;
      scan_allocation_expr(
        expr.body,
        { name: scratch, scratch },
        ctx,
        hooks,
        state,
      );
      return;
    }

    case "with":
      scan_allocation_expr(expr.base, scope, ctx, hooks, state);
      scan_allocation_fields(expr.fields, scope, ctx, hooks, state);
      return;

    case "struct_value": {
      const parent = record_allocation(
        expr,
        "runtime_aggregate",
        scope,
        state,
      );
      if (!parent) {
        scan_allocation_expr(expr.type_expr, scope, ctx, hooks, state);
        scan_allocation_fields(expr.fields, scope, ctx, hooks, state);
        return;
      }
      scan_allocation_expr(expr.type_expr, scope, ctx, hooks, state);
      const type_value = static_type_value(
        expr.type_expr,
        ctx as ctx & TypeStaticCtx,
      );
      if (!type_value || type_value.tag !== "struct_type") {
        scan_allocation_fields(expr.fields, scope, ctx, hooks, state);
        return;
      }
      const layout = runtime_aggregate_layout(
        expr,
        ctx as ctx & TypeStaticCtx,
      );
      for (const field of expr.fields) {
        const start = state.facts.length;
        scan_allocation_expr(field.value, scope, ctx, hooks, state);
        const field_layout = layout.fields.find((candidate) => {
          return candidate.name === field.name;
        });
        if (
          !field_layout || field_layout.tag !== "value" ||
          !field_layout.text ||
          parent.storage !== "persistent_unique_heap"
        ) {
          continue;
        }
        const children = state.facts.slice(start).filter((fact) => {
          return fact.reason === "runtime_text" &&
            fact.storage === "persistent_unique_heap" &&
            fact.ownership.tag === "unique_heap";
        });
        if (children.length !== 1) {
          continue;
        }
        const child = children[0];
        if (!child || child.ownership.tag !== "unique_heap") {
          continue;
        }
        const owned_children = parent.owned_children || [];
        owned_children.push({
          allocation_ids: [child.allocation_id],
          offset: field_layout.offset,
          ownership: child.ownership,
          layout: child.layout,
        });
        parent.owned_children = owned_children;
      }
      return;
    }

    case "struct_update":
      scan_allocation_expr(expr.base, scope, ctx, hooks, state);
      scan_allocation_fields(expr.fields, scope, ctx, hooks, state);
      return;

    case "if": {
      const union_value = hooks.runtime_union_value(expr, ctx);
      if (union_value) {
        record_runtime_union_allocations(
          union_value,
          scope,
          ctx,
          hooks,
          state,
          scan_allocation_expr,
        );
        return;
      }

      scan_allocation_expr(expr.cond, scope, ctx, hooks, state);
      scan_allocation_expr(expr.then_branch, scope, ctx, hooks, state);
      scan_allocation_expr(expr.else_branch, scope, ctx, hooks, state);
      return;
    }

    case "if_let":
      scan_allocation_if_let_expr(
        expr,
        scope,
        ctx,
        hooks,
        state,
        scan_allocation_expr,
      );
      return;

    case "field":
      scan_allocation_expr(expr.object, scope, ctx, hooks, state);
      return;

    case "index":
      scan_allocation_expr(expr.object, scope, ctx, hooks, state);
      scan_allocation_expr(expr.index, scope, ctx, hooks, state);
      return;

    case "union_case":
      record_allocation(expr, "runtime_union", scope, state);
      if (expr.type_expr) {
        scan_allocation_expr(expr.type_expr, scope, ctx, hooks, state);
      }
      if (expr.value) {
        scan_allocation_expr(expr.value, scope, ctx, hooks, state);
      }
      return;
  }
}

function scan_allocation_fields<ctx>(
  fields: CoreField[],
  scope: CoreAllocationScope,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
  state: CoreAllocationState,
): void {
  for (const field of fields) {
    scan_allocation_expr(field.value, scope, ctx, hooks, state);
  }
}
