import type { Pattern } from "./ast.ts";
import type { SourceSpan } from "./syntax.ts";

const binding_spans = new WeakMap<Pattern, SourceSpan>();

export type PatternBindingOccurrence = {
  binding: Extract<Pattern, { tag: "binding" }>;
  source: Pattern;
  binding_span?: SourceSpan;
};

export function record_pattern_binding_span(
  pattern: Pattern,
  span: SourceSpan,
): void {
  binding_spans.set(pattern, span);
}

export function pattern_bindings(
  pattern: Pattern,
): Extract<Pattern, { tag: "binding" }>[] {
  return pattern_binding_occurrences(pattern).map((occurrence) =>
    occurrence.binding
  );
}

export function pattern_binding_occurrences(
  pattern: Pattern,
): PatternBindingOccurrence[] {
  if (pattern.tag === "binding") {
    return [{
      binding: pattern,
      source: pattern,
      binding_span: binding_spans.get(pattern),
    }];
  }

  if (
    pattern.tag === "wildcard" || pattern.tag === "unit" ||
    pattern.tag === "literal" || pattern.tag === "const_value" ||
    pattern.tag === "value" ||
    pattern.tag === "type"
  ) {
    return [];
  }

  if (pattern.tag === "text_capture") {
    return [
      {
        binding: {
          tag: "binding",
          name: pattern.name,
          mode: "default",
          annotation: "Text",
        },
        source: pattern,
        binding_span: binding_spans.get(pattern),
      },
    ];
  }

  if (pattern.tag === "or") {
    const first = pattern.alternatives[0];
    if (first === undefined) {
      return [];
    }

    return pattern_binding_occurrences(first);
  }

  if (pattern.tag === "union_case") {
    if (pattern.value === undefined) {
      return [];
    }

    return pattern_binding_occurrences(pattern.value);
  }

  if (pattern.tag === "product") {
    const bindings: PatternBindingOccurrence[] = [];

    for (const entry of pattern.entries) {
      bindings.push(...pattern_binding_occurrences(entry.pattern));
    }

    if (pattern.rest !== undefined) {
      bindings.push(...pattern_binding_occurrences(pattern.rest));
    }

    return bindings;
  }

  if (pattern.tag === "record") {
    const bindings: PatternBindingOccurrence[] = [];

    for (const field of pattern.fields) {
      bindings.push(...pattern_binding_occurrences(field.pattern));
    }

    if (pattern.rest !== undefined) {
      bindings.push(...pattern_binding_occurrences(pattern.rest));
    }

    return bindings;
  }

  const bindings: PatternBindingOccurrence[] = [];

  for (const item of pattern.items) {
    bindings.push(...pattern_binding_occurrences(item));
  }

  if (pattern.rest !== undefined) {
    bindings.push(...pattern_binding_occurrences(pattern.rest));
  }

  return bindings;
}

export function is_irrefutable_binding_pattern(pattern: Pattern): boolean {
  if (
    pattern.tag === "binding" || pattern.tag === "wildcard" ||
    pattern.tag === "unit"
  ) {
    return true;
  }

  if (
    pattern.tag === "literal" || pattern.tag === "text_capture" ||
    pattern.tag === "const_value" || pattern.tag === "value" ||
    pattern.tag === "type" || pattern.tag === "union_case"
  ) {
    return false;
  }

  if (pattern.tag === "or") {
    return pattern.alternatives.some(is_irrefutable_binding_pattern);
  }

  if (pattern.tag === "product") {
    const entries_are_irrefutable = pattern.entries.every((entry) =>
      is_irrefutable_binding_pattern(entry.pattern)
    );
    if (!entries_are_irrefutable) return false;
    if (pattern.rest === undefined) return true;
    return is_irrefutable_binding_pattern(pattern.rest);
  }

  if (pattern.tag === "record") {
    const fields_are_irrefutable = pattern.fields.every((field) =>
      is_irrefutable_binding_pattern(field.pattern)
    );
    if (!fields_are_irrefutable) return false;
    if (pattern.rest === undefined) return true;
    return is_irrefutable_binding_pattern(pattern.rest);
  }

  if (
    !pattern.items.every(is_irrefutable_binding_pattern)
  ) {
    return false;
  }
  if (pattern.rest === undefined) return true;
  return is_irrefutable_binding_pattern(pattern.rest);
}

export function shadow_pattern_names(
  names: Set<string>,
  pattern: Pattern,
): Set<string> {
  const local = new Set(names);

  for (const binding of pattern_bindings(pattern)) {
    local.delete(binding.name);
  }

  return local;
}
