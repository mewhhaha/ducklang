import type { Source } from "./ast.ts";
import {
  invalidate_source_facts,
  source_facts,
  source_type_display_name,
} from "./source_facts.ts";

export function apply_front_inferred_nominal_bindings(source: Source): Source {
  const facts = source_facts(source);
  let changed = false;

  for (const statement of facts.statements) {
    if (statement.tag !== "bind" || statement.annotation !== undefined) {
      continue;
    }

    const type = facts.editor_type_of.get(statement.value);

    if (type?.nominal === undefined) {
      continue;
    }

    statement.annotation = source_type_display_name(type);
    changed = true;
  }

  if (changed) {
    invalidate_source_facts(source);
  }

  return source;
}
