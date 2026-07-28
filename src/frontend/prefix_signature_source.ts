import type { BabaCstNode, BabaParseResult } from "./baba_parser.ts";
import {
  type PrefixDefinition,
  type PrefixSignature,
} from "./prefix_signature.ts";
import { is_snake_case } from "./names.ts";
import {
  is_runtime_binding_name,
  unsupported_reserved_feature,
} from "./parser_support.ts";

export type PrefixSourceMetadata = {
  signatures: PrefixSignature[];
  definitions: PrefixDefinition[];
  masked_source: string;
};

export function extract_prefix_source_metadata(
  parsed: BabaParseResult,
): PrefixSourceMetadata {
  const signatures: PrefixSignature[] = [];
  const definitions: PrefixDefinition[] = [];
  const masked = parsed.cst.text.split("");
  const root = parsed.cst.root;
  if (root === undefined) {
    return { signatures, definitions, masked_source: parsed.cst.text };
  }

  visit(root, parsed.cst.text, signatures, definitions, masked, "root");
  for (let index = 0; index < signatures.length; index += 1) {
    const signature = signatures[index];
    if (signature === undefined) continue;
    const definition = definitions.find((candidate) =>
      candidate.name === signature.name && candidate.scope === signature.scope
    );
    if (definition === undefined) continue;
    signatures[index] = Object.freeze({
      ...signature,
      kind: definition.kind,
    });
  }
  return {
    signatures,
    definitions,
    masked_source: masked.join(""),
  };
}

function visit(
  node: BabaCstNode,
  source: string,
  signatures: PrefixSignature[],
  definitions: PrefixDefinition[],
  masked: string[],
  scope: string,
): void {
  if (node.kind === "prefix_signature_statement") {
    const signature = signature_from_node(node, source, scope);
    if (signature !== undefined) signatures.push(signature);
    mask_span(masked, node.start, node.end);
  }
  if (node.kind === "binding_statement") {
    definitions.push(...definitions_from_node(node, source, scope));
  }
  if (node.kind === "prefix_fact_statement") {
    definitions.push(...definitions_from_node(node, source, scope));
    mask_span(masked, node.start, node.end);
  }
  for (const child of node.children) {
    let child_scope = scope;
    if (introduces_scope(node.kind)) child_scope = scope + "/" + node.id;
    visit(child, source, signatures, definitions, masked, child_scope);
  }
}

function introduces_scope(kind: string): boolean {
  return kind === "block" || kind === "conditional_branch" ||
    kind === "else_clause" || kind === "else_if_clause" ||
    kind === "_collection_range_body" || kind === "_numeric_range_body";
}

function signature_from_node(
  node: BabaCstNode,
  source: string,
  scope: string,
): PrefixSignature | undefined {
  const name_node = node.children.find((child) =>
    child.kind === "lowercase_identifier"
  );
  const type_node = node.children.find((child) =>
    child.kind === "prefix_signature_type"
  );
  if (name_node === undefined || type_node === undefined) return undefined;
  const full_type_text = source.slice(type_node.start, type_node.end);
  const inline_clause = full_type_text.match(
    /\b(requires|ensures|decreases)\b/,
  );
  let type_end = type_node.end;
  let clauses_start = type_node.end;
  if (inline_clause !== null && inline_clause.index !== undefined) {
    type_end = type_node.start + inline_clause.index;
    clauses_start = type_end;
  }
  const requires: string[] = [];
  const ensures: string[] = [];
  const decreases: string[] = [];
  const clause_text = source.slice(clauses_start, node.end);
  const clause_pattern = /\b(requires|ensures|decreases)\b/g;
  const clause_matches: RegExpExecArray[] = [];
  let clause_match: RegExpExecArray | null;
  while ((clause_match = clause_pattern.exec(clause_text)) !== null) {
    clause_matches.push(clause_match);
  }
  for (let index = 0; index < clause_matches.length; index += 1) {
    const match = clause_matches[index];
    if (match === undefined) continue;
    const next = clause_matches[index + 1];
    let end = clause_text.length;
    if (next !== undefined && next.index !== undefined) end = next.index;
    let proposition = clause_text.slice(match.index + match[0].length, end)
      .trim();
    proposition = proposition.replace(/[;]+$/, "").trim();
    if (proposition.length === 0) proposition = "false";
    if (match[1] === "requires") requires.push(proposition);
    if (match[1] === "ensures") ensures.push(proposition);
    if (match[1] === "decreases") decreases.push(proposition);
  }
  return {
    name: source.slice(name_node.start, name_node.end),
    kind: "let",
    scope,
    type_text: source.slice(type_node.start, type_end).trimEnd(),
    requires,
    ensures,
    decreases,
    span: { start: node.start, end: node.end },
  };
}

function definitions_from_node(
  node: BabaCstNode,
  source: string,
  scope: string,
): PrefixDefinition[] {
  let kind: PrefixDefinition["kind"] = "let";
  let body_text: string | undefined;
  let names: string[] = [];
  if (node.kind === "prefix_fact_statement") {
    kind = "fact";
    const name_node = node.children.find((child) =>
      child.kind === "identifier" || child.kind === "lowercase_identifier"
    );
    if (name_node !== undefined) {
      names = [source.slice(name_node.start, name_node.end)];
    }
    const body_node = node.children.find((child) =>
      child.kind === "prefix_fact_value"
    );
    if (body_node !== undefined) {
      body_text = source.slice(body_node.start, body_node.end).trim();
    }
    if (node.children.some((child) => child.kind === '"opaque"')) {
      kind = "opaque fact";
    }
  } else {
    const kind_node = node.children.find((child) =>
      child.kind === '"let"' || child.kind === '"const"'
    );
    if (kind_node === undefined) return [];
    if (kind_node.kind === '"const"') kind = "const";
    const equals_node = node.children.find((child) =>
      source.slice(child.start, child.end) === "="
    );
    if (equals_node === undefined) return [];
    const seen = new Set<string>();
    for (
      const pattern_node of node.children.filter((child) =>
        child.end <= equals_node.start &&
        is_definition_pattern_node(child)
      )
    ) {
      for (const name of binding_names_from_pattern(pattern_node, source)) {
        if (seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    }
    for (let index = 0; index < node.children.length - 1; index += 1) {
      const separator = node.children[index];
      const mutual_name = node.children[index + 1];
      if (
        separator === undefined || mutual_name === undefined ||
        source.slice(separator.start, separator.end) !== "and" ||
        mutual_name.kind !== "identifier"
      ) {
        continue;
      }
      const name = source.slice(mutual_name.start, mutual_name.end);
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }
  return names.map((name) => {
    const definition: PrefixDefinition = {
      name,
      kind,
      scope,
      span: { start: node.start, end: node.end },
    };
    if (body_text !== undefined) definition.body_text = body_text;
    return definition;
  });
}

function binding_names_from_pattern(
  node: BabaCstNode,
  source: string,
): string[] {
  if (node.kind === "identifier") {
    const name = source.slice(node.start, node.end);
    if (name === "true" || name === "false") return [];
    if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return [];
    if (!is_snake_case(name)) return [];
    if (!is_runtime_binding_name(name)) return [];
    if (unsupported_reserved_feature(name) !== undefined) return [];
    return [name];
  }
  if (node.kind === "string") {
    let decoded: unknown;
    try {
      decoded = JSON.parse(source.slice(node.start, node.end));
    } catch (_error) {
      return [];
    }
    if (typeof decoded !== "string") return [];
    const captures = Array.from(
      decoded.matchAll(/\$\{([a-z_][A-Za-z0-9_]*)\}/g),
    );
    if (captures.length !== 1) return [];
    const name = captures[0]?.[1];
    if (name === undefined || !is_snake_case(name)) return [];
    if (!is_runtime_binding_name(name)) return [];
    if (unsupported_reserved_feature(name) !== undefined) return [];
    return [name];
  }
  if (
    node.kind === "wildcard" || node.kind === "unit_pattern" ||
    node.kind === "number" || node.kind === "character" ||
    node.kind === "boolean" || node.kind === "const_value_pattern" ||
    node.kind === "type_pattern"
  ) {
    return [];
  }
  if (node.kind === "named_shape_pattern_field") {
    const name_node = node.children.find((child) =>
      child.kind === "identifier" || child.kind === '"end"'
    );
    if (name_node === undefined) return [];
    const explicit_pattern = node.children.find((child) =>
      child !== name_node && is_definition_pattern_node(child)
    );
    if (explicit_pattern !== undefined) {
      return binding_names_from_pattern(explicit_pattern, source);
    }
    const name = source.slice(name_node.start, name_node.end);
    if (!is_snake_case(name)) return [];
    if (!is_runtime_binding_name(name)) return [];
    if (unsupported_reserved_feature(name) !== undefined) return [];
    return [name];
  }
  const names: string[] = [];
  for (const child of node.children) {
    if (!is_definition_pattern_node(child)) continue;
    names.push(...binding_names_from_pattern(child, source));
  }
  return names;
}

function is_definition_pattern_node(node: BabaCstNode): boolean {
  return node.kind === "alternative_pattern" ||
    node.kind === "identifier" ||
    node.kind === "wildcard" ||
    node.kind === "unit_pattern" ||
    node.kind === "number" ||
    node.kind === "string" ||
    node.kind === "character" ||
    node.kind === "boolean" ||
    node.kind === "const_value_pattern" ||
    node.kind === "union_pattern" ||
    node.kind === "array_pattern" ||
    node.kind === "array_rest_pattern" ||
    node.kind === "positional_product_pattern" ||
    node.kind === "product_rest_pattern" ||
    node.kind === "named_shape_pattern" ||
    node.kind === "named_shape_pattern_field" ||
    node.kind === "type_pattern";
}

function mask_span(source: string[], start: number, end: number): void {
  const bounded_start = Math.max(0, start);
  const bounded_end = Math.min(source.length, end);
  for (let index = bounded_start; index < bounded_end; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") source[index] = " ";
  }
}
