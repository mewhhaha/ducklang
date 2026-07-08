import { expect } from "../expect.ts";
import type { Env, FrontType, Stmt } from "./ast.ts";
import {
  structured_core_route,
  unresolved_import_route,
} from "./diagnostic.ts";
import {
  lower_static_rec_assign,
  lower_static_rec_bind,
  lower_static_rec_index_assign,
} from "./rec_block/binding.ts";
import {
  lower_static_rec_if_let_stmt,
  lower_static_rec_if_stmt,
} from "./rec_block/branch.ts";
import type {
  StaticRecExpectedResultLowerer,
  StaticRecExprLowerer,
} from "./rec_block/types.ts";
import type { StaticRecHooks } from "./rec_hooks.ts";
import type { StaticRecBlockLowerer, StaticRecResult } from "./rec_result.ts";
import { simple_alias_block_value } from "./typed_block.ts";

export type {
  StaticRecExpectedResultLowerer,
  StaticRecExprLowerer,
} from "./rec_block/types.ts";

export function lower_static_rec_block(
  stmts: Stmt[],
  env: Env,
  hooks: StaticRecHooks,
  lower_static_rec_expr: StaticRecExprLowerer,
  lower_rec_result_expr_with_expected_type: StaticRecExpectedResultLowerer,
  expected_type?: FrontType,
): StaticRecResult | undefined {
  const block_lowerer: StaticRecBlockLowerer = (
    block_stmts,
    block_env,
    block_hooks,
    block_expected_type,
  ) =>
    lower_static_rec_block(
      block_stmts,
      block_env,
      block_hooks,
      lower_static_rec_expr,
      lower_rec_result_expr_with_expected_type,
      block_expected_type,
    );

  if (expected_type) {
    const alias = simple_alias_block_value(
      { tag: "block", statements: stmts },
      expected_type,
      env,
      { resolve_annotation_type: hooks.resolve_annotation_type },
    );

    if (alias) {
      return {
        tag: "done",
        value: lower_rec_result_expr_with_expected_type(
          alias,
          env,
          hooks,
          block_lowerer,
          expected_type,
        ),
      };
    }
  }

  const local = hooks.clone_env(env);

  for (let index = 0; index < stmts.length; index += 1) {
    const stmt = stmts[index];
    expect(stmt, "Missing rec body statement " + index);
    const is_final = index + 1 >= stmts.length;

    if (stmt.tag === "expr") {
      if (is_final) {
        return lower_static_rec_expr(
          stmt.expr,
          local,
          hooks,
          expected_type,
        );
      }

      lower_rec_result_expr_with_expected_type(
        stmt.expr,
        local,
        hooks,
        block_lowerer,
      );
    } else if (stmt.tag === "return") {
      return lower_static_rec_expr(stmt.value, local, hooks, expected_type);
    } else if (stmt.tag === "bind") {
      lower_static_rec_bind(stmt, local, hooks);
    } else if (stmt.tag === "assign") {
      lower_static_rec_assign(stmt, local, hooks);
    } else if (stmt.tag === "index_assign") {
      lower_static_rec_index_assign(stmt, local, hooks);
    } else if (stmt.tag === "for_range") {
      const expanded = hooks.expand_for_range(stmt, local);
      const rest = stmts.slice(index + 1);
      return block_lowerer(
        [...expanded, ...rest],
        local,
        hooks,
      );
    } else if (stmt.tag === "for_collection") {
      const expanded = hooks.expand_for_collection(stmt, local);
      const rest = stmts.slice(index + 1);
      return block_lowerer(
        [...expanded, ...rest],
        local,
        hooks,
      );
    } else if (stmt.tag === "if_stmt") {
      const result = lower_static_rec_if_stmt(
        stmt,
        stmts.slice(index + 1),
        local,
        hooks,
        block_lowerer,
        lower_rec_result_expr_with_expected_type,
        expected_type,
      );

      if (result) {
        return result;
      }
    } else if (stmt.tag === "if_let_stmt") {
      const result = lower_static_rec_if_let_stmt(
        stmt,
        stmts.slice(index + 1),
        local,
        hooks,
        block_lowerer,
        lower_rec_result_expr_with_expected_type,
        expected_type,
      );

      if (result) {
        return result;
      }
    } else if (stmt.tag === "type_check") {
      hooks.check_type_pattern(stmt.pattern, stmt.target, local);
    } else if (stmt.tag === "break" || stmt.tag === "continue") {
      throw new Error(
        "Cannot lower rec " + stmt.tag + " body yet" +
          structured_core_route,
      );
    } else if (stmt.tag === "import") {
      throw new Error(
        "Cannot lower unresolved import; " + unresolved_import_route,
      );
    } else if (stmt.tag === "host_import") {
      throw new Error(
        "Cannot lower host import through static rec; " +
          "use Source.core, Source.mod, or Source.wat",
      );
    } else {
      throw new Error(
        "Cannot lower rec " + stmt.tag + " body yet" +
          structured_core_route,
      );
    }
  }

  return undefined;
}
