import type { Ic as IcNode } from "../../ic.ts";
import type { Env, Stmt } from "../ast.ts";
import type {
  LowerStatementsWithDone,
  StatementDone,
  StatementLowerHooks,
} from "./types.ts";

export function lower_binding_body(
  stmts: Stmt[],
  index: number,
  env: Env,
  ic_name: string,
  hooks: StatementLowerHooks,
  on_done: StatementDone,
  lower_statements_with_done: LowerStatementsWithDone,
): IcNode {
  if (index + 1 >= stmts.length) {
    if (on_done) {
      return on_done();
    }

    return { tag: "var", name: ic_name };
  }

  return lower_statements_with_done(
    stmts,
    index + 1,
    env,
    hooks,
    on_done,
  );
}
