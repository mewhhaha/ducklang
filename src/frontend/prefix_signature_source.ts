import type { BabaCstNode, BabaParseResult } from "./baba_parser.ts";
import {
  type PrefixDefinition,
  type PrefixSignature,
} from "./prefix_signature.ts";

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
  const type_node = node.children.find((child) => child.kind === "prefix_signature_type");
  if (name_node === undefined || type_node === undefined) return undefined;
  const full_type_text = source.slice(type_node.start, type_node.end);
  const inline_clause = full_type_text.match(/\b(requires|ensures|decreases)\b/);
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
    let proposition = clause_text.slice(match.index + match[0].length, end).trim();
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
  const name_nodes = node.children.filter((child) =>
    child.kind === "identifier" || child.kind === "lowercase_identifier"
  );
  if (name_nodes.length === 0) return [];
  let kind: PrefixDefinition["kind"] = "let";
  let body_text: string | undefined;
  if (node.kind === "prefix_fact_statement") {
    kind = "fact";
    const body_node = node.children.find((child) => child.kind === "prefix_fact_value");
    if (body_node !== undefined) body_text = source.slice(body_node.start, body_node.end).trim();
    if (node.children.some((child) => child.kind === "\"opaque\"")) {
      kind = "opaque fact";
    }
  } else {
    const kind_node = node.children.find((child) =>
      child.kind === "\"let\"" || child.kind === "\"const\""
    );
    if (kind_node === undefined) return [];
    if (kind_node.kind === "\"const\"") kind = "const";
  }
  return name_nodes.map((name_node) => {
    const definition: PrefixDefinition = {
      name: source.slice(name_node.start, name_node.end),
      kind,
      scope,
      span: { start: node.start, end: node.end },
    };
    if (body_text !== undefined) definition.body_text = body_text;
    return definition;
  });
}

function mask_span(source: string[], start: number, end: number): void {
  const bounded_start = Math.max(0, start);
  const bounded_end = Math.min(source.length, end);
  for (let index = bounded_start; index < bounded_end; index += 1) {
    if (source[index] !== "\n" && source[index] !== "\r") source[index] = " ";
  }
}
