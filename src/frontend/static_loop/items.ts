import { expect } from "../../expect.ts";
import type { Env, FrontExpr, TypeField } from "../ast.ts";
import { capture_expr } from "../capture.ts";
import type { CollectionLoopItem, ForCollectionStmt } from "./types.ts";

export function static_struct_collection_items(
  target: { expr: Extract<FrontExpr, { tag: "struct_value" }>; env: Env },
): CollectionLoopItem[] {
  const items: CollectionLoopItem[] = [];

  for (let index = 0; index < target.expr.fields.length; index += 1) {
    const field = target.expr.fields[index];
    expect(field, "Missing collection field " + index);
    items.push({
      index,
      value: capture_expr(field.value, target.env),
    });
  }

  return items;
}

export function text_collection_items(bytes: number[]): CollectionLoopItem[] {
  const items: CollectionLoopItem[] = [];

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    expect(byte !== undefined, "Missing text collection byte " + index);
    items.push({
      index,
      value: { tag: "num", type: "i32", value: byte },
    });
  }

  return items;
}

export function runtime_struct_collection_items(
  stmt: ForCollectionStmt,
  fields: TypeField[],
): CollectionLoopItem[] {
  const items: CollectionLoopItem[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    expect(field, "Missing runtime collection field " + index);
    items.push({
      index,
      value: {
        tag: "field",
        object: stmt.collection,
        name: field.name,
      },
    });
  }

  return items;
}

export function collection_index_value(item: CollectionLoopItem): FrontExpr {
  return { tag: "num", type: "i32", value: item.index };
}
