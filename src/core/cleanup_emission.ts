import type { Core, CoreCleanupEmission } from "./ast.ts";
import type { CoreStmt } from "./ast.ts";
import type { CoreDropPlan } from "./drop.ts";

export function elaborate_core_cleanup_emission(
  core: Core,
  drops: CoreDropPlan,
): CoreCleanupEmission[] {
  const result: CoreCleanupEmission[] = [];
  const anchors = cleanup_anchors(core.statements);
  const next_anchor = new Map<string, number>();
  const next_assignment_anchor = new Map<string, number>();
  const prior_scope = new Map<string, string>();

  for (const step of drops.steps) {
    if (step.tag !== "heap_drop") {
      continue;
    }

    if (!step.byte_size || !step.alignment || !step.layout) {
      continue;
    }

    const allocation_ids = [...(step.allocation_ids || [])];
    if (step.allocation_id) {
      allocation_ids.push(step.allocation_id);
    }

    if (allocation_ids.length === 0) {
      continue;
    }

    let anchor: CleanupAnchor | undefined;

    if (step.edge === "assignment_replace") {
      const owner = step.owner;
      if (!owner) {
        throw new Error("Assignment cleanup requires an owner");
      }
      const assignment_anchors = (anchors.get(step.edge) || []).filter(
        (candidate) => {
          return candidate.stmt.tag === "assign" &&
            candidate.stmt.name === owner;
        },
      );
      const anchor_index = next_assignment_anchor.get(owner) || 0;
      anchor = assignment_anchors[anchor_index];
      next_assignment_anchor.set(owner, anchor_index + 1);
    } else if (step.edge === "scope_exit") {
      anchor = (anchors.get(step.edge) || []).find((candidate) => {
        return candidate.scope === step.scope;
      });
    } else {
      let anchor_index = next_anchor.get(step.edge) || 0;
      if (prior_scope.get(step.edge) !== step.scope) {
        next_anchor.set(step.edge, anchor_index + 1);
        prior_scope.set(step.edge, step.scope);
      } else if (anchor_index > 0) {
        anchor_index -= 1;
      }
      anchor = anchors.get(step.edge)?.[anchor_index];
    }
    const row: CoreCleanupEmission = {
      step_id: step.id,
      allocation_ids,
      edge: step.edge,
      scope: step.scope,
      owner: step.owner,
      pointer_local: cleanup_pointer_local(step.id, step.owner),
      statement_index: cleanup_statement_index(
        core,
        step.owner,
        step.edge,
        step.scope,
      ),
      statement_path: anchor?.path,
      byte_size: step.byte_size,
      alignment: step.alignment,
      layout: step.layout,
      owned_children: step.owned_children || [],
    };
    result.push(row);
    if (anchor) {
      const rows = statement_cleanup_rows.get(anchor.stmt) || [];
      rows.push(row);
      statement_cleanup_rows.set(anchor.stmt, rows);
    }
  }

  return result;
}

function cleanup_pointer_local(
  step_id: string,
  owner: string | undefined,
): string | undefined {
  if (owner) {
    return undefined;
  }

  return "_cleanup_" + step_id;
}

const statement_cleanup_rows = new WeakMap<CoreStmt, CoreCleanupEmission[]>();

export function core_statement_cleanup_rows(
  stmt: CoreStmt,
): CoreCleanupEmission[] {
  return statement_cleanup_rows.get(stmt) || [];
}

type CleanupAnchor = { stmt: CoreStmt; path: number[]; scope: string };

function cleanup_anchors(
  statements: CoreStmt[],
): Map<CoreCleanupEmission["edge"], CleanupAnchor[]> {
  const result = new Map<CoreCleanupEmission["edge"], CleanupAnchor[]>();
  let next_block = 0;
  let next_loop = 0;

  function add(edge: CoreCleanupEmission["edge"], anchor: CleanupAnchor): void {
    const values = result.get(edge) || [];
    values.push(anchor);
    result.set(edge, values);
  }

  function scan(items: CoreStmt[], parent: number[], scope: string): void {
    for (let index = 0; index < items.length; index += 1) {
      const stmt = items[index];
      if (!stmt) {
        continue;
      }
      statement_cleanup_rows.delete(stmt);
      const path = parent.concat(index);
      const anchor = { stmt, path, scope };
      if (stmt.tag === "assign") {
        add("assignment_replace", anchor);
      }
      if (stmt.tag === "expr") {
        add("discarded_expr", anchor);
      }
      if (stmt.tag === "return") {
        add("return_exit", anchor);
      }
      if (stmt.tag === "break") {
        add("break_exit", anchor);
      }
      if (stmt.tag === "continue") {
        add("continue_exit", anchor);
      }
      if (
        stmt.tag === "if_stmt" || stmt.tag === "if_else_stmt" ||
        stmt.tag === "if_let_stmt"
      ) {
        add("conditional_cleanup", anchor);
      }
      if (stmt.tag === "range_loop" || stmt.tag === "collection_loop") {
        add("loop_zero_iteration_cleanup", anchor);
      }
      if (stmt.tag === "if_stmt" || stmt.tag === "if_let_stmt") {
        const block_scope = "block#" + next_block.toString();
        next_block += 1;
        scan(stmt.body, path.concat(0), block_scope);
      } else if (stmt.tag === "if_else_stmt") {
        const then_scope = "block#" + next_block.toString();
        next_block += 1;
        scan(stmt.then_body, path.concat(0), then_scope);
        const else_scope = "block#" + next_block.toString();
        next_block += 1;
        scan(stmt.else_body, path.concat(1), else_scope);
      } else if (
        stmt.tag === "range_loop" || stmt.tag === "collection_loop"
      ) {
        const loop_scope = "loop#" + next_loop.toString();
        next_loop += 1;
        scan(stmt.body, path.concat(0), loop_scope);
      }
    }

    const final_index = items.length - 1;
    const final_stmt = items[final_index];
    if (final_stmt) {
      add("scope_exit", {
        stmt: final_stmt,
        path: parent.concat(final_index),
        scope,
      });
    }
  }

  scan(statements, [], "program#0");
  return result;
}

function cleanup_statement_index(
  core: Core,
  owner: string | undefined,
  edge: CoreCleanupEmission["edge"],
  scope: string,
): number | undefined {
  if (edge === "scope_exit") {
    if (scope !== "program#0") {
      return undefined;
    }
    return core.statements.length - 1;
  }

  if (edge === "assignment_replace") {
    return core.statements.findIndex((stmt) => {
      return stmt.tag === "assign" && stmt.name === owner;
    });
  }

  if (edge === "discarded_expr") {
    return core.statements.findIndex((stmt) => stmt.tag === "expr");
  }

  if (
    edge === "conditional_cleanup" || edge === "loop_zero_iteration_cleanup"
  ) {
    return core.statements.findIndex((stmt) => {
      return stmt.tag === "range_loop" || stmt.tag === "collection_loop" ||
        stmt.tag === "if_stmt" || stmt.tag === "if_else_stmt" ||
        stmt.tag === "if_let_stmt";
    });
  }

  return undefined;
}
