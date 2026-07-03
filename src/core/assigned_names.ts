import type { CoreStmt } from "./ast.ts";

export function assigned_stmt_names(stmt: CoreStmt): string[] {
  const names: string[] = [];

  function add(name: string): void {
    if (!names.includes(name)) {
      names.push(name);
    }
  }

  function visit(item: CoreStmt): void {
    switch (item.tag) {
      case "assign":
      case "index_assign":
        add(item.name);
        return;

      case "range_loop":
      case "collection_loop":
        for (const name of item.carried) {
          add(name);
        }

        return;

      case "if_stmt":
      case "if_let_stmt":
        for (const child of item.body) {
          visit(child);
        }

        return;

      case "if_else_stmt":
        for (const child of item.then_body) {
          visit(child);
        }

        for (const child of item.else_body) {
          visit(child);
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

  visit(stmt);
  return names;
}
