import { expect } from "../expect.ts";
import type { FrontExpr, HandlerState, Stmt } from "./ast.ts";
import { ParserConditional } from "./parser_conditional.ts";
import { mark_source_span } from "./syntax.ts";
import { copy_name_sites } from "./name_site.ts";

export abstract class ParserBlock extends ParserConditional {
  protected abstract parse_stmt(): Stmt;

  protected parse_block(): FrontExpr {
    const start = this.index;
    const block = this.parse_block_inner();
    return this.concrete_node(start, block);
  }

  private parse_block_inner(): FrontExpr {
    this.expect_symbol("{");
    const statements: Stmt[] = [];
    this.skip_newlines();

    while (!this.match_symbol("}")) {
      expect(!this.is("eof"), "Unterminated block");
      const state = this.parser_state();
      let stmt: Stmt;

      try {
        stmt = this.parse_stmt();
      } catch (error) {
        if (!this.recovering) {
          throw error;
        }

        const failure = this.index;
        this.restore_parser_state(state);
        this.synchronize_statement();
        this.record_recovery(error, state.index, failure);
        this.skip_newlines();
        continue;
      }

      mark_source_span(stmt, this.parsed_span(state.index));
      this.skip_newlines();

      const final_expr = block_final_conditional_expr(stmt);

      if (
        final_expr && this.peek().kind === "symbol" &&
        this.peek().text === "}"
      ) {
        statements.push({ tag: "expr", expr: final_expr });
      } else {
        statements.push(stmt);
      }
    }

    const handler = block_handler(statements);

    if (!handler) {
      return { tag: "block", statements };
    }

    const state: HandlerState[] = [];

    for (let index = 0; index < statements.length - 1; index += 1) {
      const stmt = statements[index];
      expect(stmt, "Missing handler state statement");
      expect(
        stmt.tag === "bind" && stmt.kind === "let" && !stmt.is_recursive &&
          !stmt.is_linear && !stmt.effectful,
        "Handler state block may contain only leading ordinary `let` bindings",
      );
      const state_item = {
        name: stmt.name,
        annotation: stmt.annotation,
        value: stmt.value,
      };
      copy_name_sites(stmt, state_item);
      state.push(state_item);
    }

    const result = { ...handler, state: [...state, ...handler.state] };
    copy_name_sites(handler, result);
    return result;
  }
}

function block_handler(
  statements: Stmt[],
): Extract<FrontExpr, { tag: "handler" }> | undefined {
  const last = statements[statements.length - 1];

  if (!last || last.tag !== "expr" || last.expr.tag !== "handler") {
    return undefined;
  }

  return last.expr;
}

function block_final_conditional_expr(stmt: Stmt): FrontExpr | undefined {
  if (stmt.tag === "if_stmt") {
    if (!block_statements_have_result(stmt.body)) {
      return undefined;
    }

    const result: Extract<FrontExpr, { tag: "if" }> = {
      tag: "if",
      cond: stmt.cond,
      then_branch: { tag: "block", statements: stmt.body },
      else_branch: { tag: "num", type: "i32", value: 0 },
      implicit_else: true,
    };
    copy_name_sites(stmt, result);
    return result;
  }

  if (stmt.tag === "if_let_stmt") {
    if (!block_statements_have_result(stmt.body)) {
      return undefined;
    }

    const result: Extract<FrontExpr, { tag: "if_let" }> = {
      tag: "if_let",
      case_name: stmt.case_name,
      value_name: stmt.value_name,
      target: stmt.target,
      then_branch: { tag: "block", statements: stmt.body },
      else_branch: { tag: "num", type: "i32", value: 0 },
      implicit_else: true,
    };
    copy_name_sites(stmt, result);
    return result;
  }

  return undefined;
}

function block_statements_have_result(statements: Stmt[]): boolean {
  if (statements.length === 0) {
    return false;
  }

  const last = statements[statements.length - 1];

  if (!last) {
    return false;
  }

  return last.tag === "expr";
}
