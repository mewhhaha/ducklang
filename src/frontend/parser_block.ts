import { expect } from "../expect.ts";
import type { FrontExpr, Stmt } from "./ast.ts";
import { ParserConditional } from "./parser_conditional.ts";

export abstract class ParserBlock extends ParserConditional {
  protected abstract parse_stmt(): Stmt;

  protected parse_block(): FrontExpr {
    this.expect_symbol("{");
    const statements: Stmt[] = [];
    this.skip_newlines();

    while (!this.match_symbol("}")) {
      expect(!this.is("eof"), "Unterminated block");
      const stmt = this.parse_stmt();
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

    return { tag: "block", statements };
  }
}

function block_final_conditional_expr(stmt: Stmt): FrontExpr | undefined {
  if (stmt.tag === "if_stmt") {
    if (!block_statements_have_result(stmt.body)) {
      return undefined;
    }

    return {
      tag: "if",
      cond: stmt.cond,
      then_branch: { tag: "block", statements: stmt.body },
      else_branch: { tag: "num", type: "i32", value: 0 },
      implicit_else: true,
    };
  }

  if (stmt.tag === "if_let_stmt") {
    if (!block_statements_have_result(stmt.body)) {
      return undefined;
    }

    return {
      tag: "if_let",
      case_name: stmt.case_name,
      value_name: stmt.value_name,
      target: stmt.target,
      then_branch: { tag: "block", statements: stmt.body },
      else_branch: { tag: "num", type: "i32", value: 0 },
      implicit_else: true,
    };
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
