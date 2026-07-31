import type { BabaCstNode, BabaParseResult } from "./baba_parser.ts";
import {
  type PrefixCallableType,
  type PrefixDefinition,
  type PrefixProofTerm,
  type PrefixProposition,
  type PrefixSignature,
  type PrefixSignatureBinder,
  type PrefixSignatureParameter,
  type PrefixSignatureResult,
  type PrefixSpan,
  type PrefixTacticCommand,
  type PrefixTerm,
  type PrefixTypeReference,
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
  if (node.kind === "prefix_unsafe_proof_statement") {
    definitions.push(...definitions_from_node(node, source, scope));
    return;
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
  const type = callable_type_from_node(type_node, source);
  if (type === undefined) return undefined;
  const requires: PrefixProposition[] = [];
  const ensures: PrefixProposition[] = [];
  const decreases: PrefixTerm[] = [];
  for (
    const clause of node.children.filter((child) =>
      child.kind === "prefix_contract_clause"
    )
  ) {
    const clause_name = clause.children.find((child) =>
      child.kind === "prefix_requires_keyword" ||
      child.kind === "prefix_ensures_keyword" ||
      child.kind === "prefix_decreases_keyword"
    );
    if (clause_name === undefined) continue;
    if (clause_name.kind === "prefix_decreases_keyword") {
      const metric = clause.children.find((child) =>
        child.start >= clause_name.end
      );
      if (metric !== undefined) decreases.push(term_from_node(metric, source));
      continue;
    }
    const proposition_node = clause.children.find((child) =>
      child.kind === "prefix_proposition"
    );
    if (proposition_node === undefined) continue;
    const proposition = proposition_from_node(proposition_node, source);
    if (proposition === undefined) continue;
    if (clause_name.kind === "prefix_requires_keyword") {
      requires.push(proposition);
    }
    if (clause_name.kind === "prefix_ensures_keyword") {
      ensures.push(proposition);
    }
  }
  return {
    name: source.slice(name_node.start, name_node.end),
    kind: "let",
    scope,
    type,
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
  let definition_node = node;
  let unsafe_span: PrefixSpan | undefined;
  if (node.kind === "prefix_unsafe_proof_statement") {
    const unsafe = node.children.find((child) => child.kind === '"unsafe"');
    const nested = node.children.find((child) =>
      child.kind === "binding_statement"
    );
    if (unsafe === undefined || nested === undefined) return [];
    unsafe_span = { start: unsafe.start, end: unsafe.end };
    definition_node = nested;
  }
  let kind: PrefixDefinition["kind"] = "let";
  let recursive = false;
  let fact_parameters: string[] | undefined;
  let fact_body: PrefixProposition | undefined;
  let direct_proof_body: PrefixProofTerm | undefined;
  const callable_definitions: {
    parameters: string[];
    parameter_types: (PrefixTypeReference | undefined)[];
    body: PrefixTerm;
    proof_body?: PrefixProofTerm;
  }[] = [];
  let names: string[] = [];
  if (definition_node.kind === "prefix_fact_statement") {
    kind = "fact";
    const name_node = definition_node.children.find((child) =>
      child.kind === "identifier" || child.kind === "lowercase_identifier"
    );
    if (name_node !== undefined) {
      names = [source.slice(name_node.start, name_node.end)];
    }
    const body_node = definition_node.children.find((child) =>
      child.kind === "prefix_fact_value"
    );
    if (body_node !== undefined) {
      const parameter_node = body_node.children.find((child) =>
        child.kind === "prefix_fact_parameters"
      );
      if (parameter_node !== undefined) {
        fact_parameters = parameter_node.children.filter((child) =>
          child.kind === "identifier"
        ).map((child) => source.slice(child.start, child.end));
      }
      const proposition_node = body_node.children.find((child) =>
        child.kind === "prefix_proposition"
      );
      if (proposition_node !== undefined) {
        fact_body = proposition_from_node(proposition_node, source);
      }
    }
    if (definition_node.children.some((child) => child.kind === '"opaque"')) {
      kind = "opaque fact";
    }
  } else {
    const kind_node = definition_node.children.find((child) =>
      child.kind === '"let"' || child.kind === '"const"'
    );
    if (kind_node === undefined) return [];
    if (kind_node.kind === '"const"') kind = "const";
    recursive = definition_node.children.some((child) =>
      child.kind === '"rec"'
    );
    const equals_node = definition_node.children.find((child) =>
      source.slice(child.start, child.end) === "="
    );
    if (equals_node === undefined) return [];
    const seen = new Set<string>();
    for (
      const pattern_node of definition_node.children.filter((child) =>
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
    for (
      let index = 0;
      index < definition_node.children.length - 1;
      index += 1
    ) {
      const separator = definition_node.children[index];
      const mutual_name = definition_node.children[index + 1];
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
    for (
      const arrow_node of definition_node.children.filter((child) =>
        child.kind === "arrow_function"
      )
    ) {
      const parameters: string[] = [];
      const parameter_types: (PrefixTypeReference | undefined)[] = [];
      const arrow = arrow_node.children.find((child) => child.kind === '"=>"');
      if (arrow === undefined) continue;
      for (const child of arrow_node.children) {
        if (child.start >= arrow.start) continue;
        if (child.kind === "parameter") {
          const name_node = first_descendant(child, "identifier");
          if (name_node !== undefined) {
            parameters.push(source.slice(name_node.start, name_node.end));
            const type_node = first_descendant(child, "type_reference");
            if (type_node === undefined) {
              parameter_types.push(undefined);
            } else {
              parameter_types.push(type_reference_from_node(type_node, source));
            }
          }
          continue;
        }
        if (child.kind !== "parameter_list") continue;
        for (
          const parameter_node of child.children.filter((candidate) =>
            candidate.kind === "parameter"
          )
        ) {
          const name_node = first_descendant(parameter_node, "identifier");
          if (name_node !== undefined) {
            parameters.push(source.slice(name_node.start, name_node.end));
            const type_node = first_descendant(
              parameter_node,
              "type_reference",
            );
            if (type_node === undefined) {
              parameter_types.push(undefined);
            } else {
              parameter_types.push(type_reference_from_node(type_node, source));
            }
          }
        }
      }
      const body = arrow_node.children.find((child) =>
        child.start >= arrow.end
      );
      if (body === undefined) continue;
      callable_definitions.push({
        parameters,
        parameter_types,
        body: term_from_node(body, source),
        proof_body: proof_body_from_node(body, source),
      });
    }
    if (callable_definitions.length === 0) {
      for (const child of definition_node.children) {
        if (child.start < equals_node.end) continue;
        direct_proof_body = proof_body_from_node(child, source);
        if (direct_proof_body !== undefined) break;
      }
    }
  }
  return names.map((name, index) => {
    const definition: PrefixDefinition = {
      name,
      kind,
      scope,
      recursive,
      span: { start: definition_node.start, end: definition_node.end },
    };
    const attribute = definition_node.children.find((child) =>
      child.kind === "attribute_group"
    );
    if (attribute !== undefined) {
      definition.attribute_span = {
        start: attribute.start,
        end: attribute.end,
      };
    }
    if (unsafe_span !== undefined) definition.unsafe_span = unsafe_span;
    const callable = callable_definitions[index];
    if (callable !== undefined) {
      definition.callable_parameters = callable.parameters;
      definition.callable_parameter_types = callable.parameter_types;
      definition.callable_body = callable.body;
      if (callable.proof_body !== undefined) {
        definition.callable_proof_body = callable.proof_body;
      }
    }
    if (callable === undefined && direct_proof_body !== undefined) {
      definition.callable_proof_body = direct_proof_body;
    }
    if (fact_parameters !== undefined) {
      definition.fact_parameters = fact_parameters;
    }
    if (fact_body !== undefined) definition.fact_body = fact_body;
    return definition;
  });
}

function callable_type_from_node(
  node: BabaCstNode,
  source: string,
): PrefixCallableType | undefined {
  const function_node = first_descendant(
    node,
    "prefix_signature_function_type",
  );
  if (function_node === undefined) return undefined;
  const binders: PrefixSignatureBinder[] = [];
  collect_descendants(node, "prefix_signature_binder", (binder_node) => {
    const binder = parameter_from_node(binder_node, source);
    if (binder !== undefined) binders.push(binder);
  });
  const parameter_list = function_node.children.find((child) =>
    child.kind === "prefix_signature_parameter_list"
  );
  const parameters: PrefixSignatureParameter[] = [];
  if (parameter_list !== undefined) {
    for (
      const parameter_node of parameter_list.children.filter((child) =>
        child.kind === "prefix_signature_parameter"
      )
    ) {
      const parameter = parameter_from_node(parameter_node, source);
      if (parameter !== undefined) parameters.push(parameter);
    }
  }
  const result_node = function_node.children.find((child) =>
    child.kind === "prefix_signature_result"
  );
  if (result_node === undefined) return undefined;
  const result = result_from_node(result_node, source);
  if (result === undefined) return undefined;
  return {
    binders,
    parameters,
    result,
    span: { start: node.start, end: node.end },
  };
}

function parameter_from_node(
  node: BabaCstNode,
  source: string,
): PrefixSignatureParameter | undefined {
  const name_node = node.children.find((child) =>
    child.kind === "identifier" || child.kind === "lowercase_identifier"
  );
  const type_node = node.children.find((child) =>
    child.kind === "prefix_signature_value_type" ||
    child.kind === "type_reference" ||
    child.kind === "prefix_refinement_type" ||
    child.kind === "prefix_proof_type"
  );
  if (name_node === undefined || type_node === undefined) return undefined;
  const type = signature_type_reference_from_node(type_node, source);
  if (type === undefined) return undefined;
  return {
    name: source.slice(name_node.start, name_node.end),
    type,
    span: { start: node.start, end: node.end },
  };
}

function result_from_node(
  node: BabaCstNode,
  source: string,
): PrefixSignatureResult | undefined {
  const type_node = node.children.find((child) =>
    child.kind === "prefix_signature_value_type" ||
    child.kind === "type_reference" ||
    child.kind === "prefix_refinement_type" ||
    child.kind === "prefix_proof_type"
  );
  if (type_node === undefined) return undefined;
  const type = signature_type_reference_from_node(type_node, source);
  if (type === undefined) return undefined;
  const result: PrefixSignatureResult = {
    type,
    span: { start: node.start, end: node.end },
  };
  if (node.children.some((child) => child.kind === '"result"')) {
    result.name = "result";
  }
  return result;
}

function signature_type_reference_from_node(
  node: BabaCstNode,
  source: string,
): PrefixTypeReference | undefined {
  let value_node = node;
  if (node.kind === "prefix_signature_value_type") {
    const child = semantic_child(node);
    if (child === undefined) return undefined;
    value_node = child;
  }
  if (value_node.kind === "type_reference") {
    return type_reference_from_node(value_node, source);
  }
  if (value_node.kind === "prefix_proof_type") {
    const proposition_node = value_node.children.find((child) =>
      child.kind === "prefix_proposition"
    );
    if (proposition_node === undefined) return undefined;
    const proposition = proposition_from_node(proposition_node, source);
    if (proposition === undefined) return undefined;
    return {
      text: source.slice(value_node.start, value_node.end),
      canonical: "Proof",
      proof: proposition,
      span: { start: value_node.start, end: value_node.end },
    };
  }
  if (value_node.kind !== "prefix_refinement_type") return undefined;
  const binder_node = value_node.children.find((child) =>
    child.kind === "lowercase_identifier"
  );
  const type_node = value_node.children.find((child) =>
    child.kind === "type_reference"
  );
  const proposition_node = value_node.children.find((child) =>
    child.kind === "prefix_proposition"
  );
  if (
    binder_node === undefined || type_node === undefined ||
    proposition_node === undefined
  ) {
    return undefined;
  }
  const proposition = proposition_from_node(proposition_node, source);
  if (proposition === undefined) return undefined;
  const type = type_reference_from_node(type_node, source);
  type.refinement = {
    binder: source.slice(binder_node.start, binder_node.end),
    proposition,
    text: source.slice(value_node.start, value_node.end),
    span: { start: value_node.start, end: value_node.end },
  };
  return type;
}

function type_reference_from_node(
  node: BabaCstNode,
  source: string,
): PrefixTypeReference {
  return {
    text: source.slice(node.start, node.end),
    canonical: canonical_type_reference(node, source),
    span: { start: node.start, end: node.end },
  };
}

function proof_body_from_node(
  node: BabaCstNode,
  source: string,
): PrefixProofTerm | undefined {
  let proof_expression = node;
  while (
    proof_expression.kind === "postfix_expression" ||
    proof_expression.kind === "parenthesized_expression" ||
    proof_expression.kind === "parenthesized_or_product"
  ) {
    const nested = semantic_child(proof_expression);
    if (nested === undefined) return undefined;
    proof_expression = nested;
  }
  if (proof_expression.kind !== "prefix_by_proof_expression") return undefined;
  const tactic_node = proof_expression.children.find((child) =>
    child.kind === "prefix_tactic_block"
  );
  if (tactic_node !== undefined) {
    const commands: PrefixTacticCommand[] = [];
    for (const child of tactic_node.children) {
      if (
        child.kind !== "prefix_tactic_command" &&
        child.kind !== "prefix_final_tactic_command"
      ) continue;
      const command = tactic_command_from_node(child, source);
      if (command === undefined) return undefined;
      commands.push(command);
    }
    return {
      tag: "tactics",
      commands,
      span: { start: tactic_node.start, end: tactic_node.end },
    };
  }
  const proof_node = proof_expression.children.find((child) =>
    child.kind === "prefix_proof_term"
  );
  if (proof_node === undefined) return undefined;
  return proof_term_from_node(proof_node, source);
}

function tactic_command_from_node(
  node: BabaCstNode,
  source: string,
): PrefixTacticCommand | undefined {
  const span = { start: node.start, end: node.end };
  const exact = node.children.find((child) => child.kind === '"exact"');
  if (exact !== undefined) {
    const proof_node = node.children.find((child) =>
      child.kind === "prefix_proof_term"
    );
    if (proof_node === undefined) return undefined;
    const proof = proof_term_from_node(proof_node, source);
    if (proof === undefined) return undefined;
    return { tag: "exact", proof, span };
  }
  const intro = node.children.find((child) => child.kind === '"intro"');
  if (intro !== undefined) {
    const name = node.children.find((child) => child.kind === "identifier");
    if (name === undefined) return undefined;
    return {
      tag: "intro",
      name: source.slice(name.start, name.end),
      span,
    };
  }
  for (
    const tag of ["assumption", "constructor", "left", "right"] as const
  ) {
    if (
      node.children.some((child) => child.kind === `"${tag}"`) ||
      source.slice(node.start, node.end).trim() === tag
    ) {
      return { tag, span };
    }
  }
  return undefined;
}

function proof_term_from_node(
  node: BabaCstNode,
  source: string,
): PrefixProofTerm | undefined {
  const span = { start: node.start, end: node.end };
  const text = source.slice(node.start, node.end);
  if (text === "refl") return { tag: "refl", span };
  if (text === "true_intro") return { tag: "true_intro", span };
  const unsafe_node = node.children.find((child) => child.kind === '"unsafe"');
  if (unsafe_node !== undefined) {
    const proposition_node = node.children.find((child) =>
      child.kind === "prefix_proposition"
    );
    if (proposition_node === undefined) return undefined;
    const proposition = proposition_from_node(proposition_node, source);
    if (proposition === undefined) return undefined;
    return { tag: "unsafe_assume", proposition, span };
  }
  const nested = node.children.filter((child) =>
    child.kind === "prefix_proof_term"
  );
  const or_cases_node = node.children.find((child) =>
    child.kind === '"or_cases"'
  );
  if (or_cases_node !== undefined) {
    const names = node.children.filter((child) => child.kind === "identifier");
    const proof_node = nested[0];
    const left_name_node = names[0];
    const left_body_node = nested[1];
    const right_name_node = names[1];
    const right_body_node = nested[2];
    if (
      proof_node === undefined || left_name_node === undefined ||
      left_body_node === undefined || right_name_node === undefined ||
      right_body_node === undefined
    ) {
      return undefined;
    }
    const proof = proof_term_from_node(proof_node, source);
    const left_body = proof_term_from_node(left_body_node, source);
    const right_body = proof_term_from_node(right_body_node, source);
    if (
      proof === undefined || left_body === undefined ||
      right_body === undefined
    ) {
      return undefined;
    }
    return {
      tag: "or_cases",
      proof,
      left_name: source.slice(left_name_node.start, left_name_node.end),
      left_body,
      right_name: source.slice(right_name_node.start, right_name_node.end),
      right_body,
      span,
    };
  }
  const forall_apply_node = node.children.find((child) =>
    child.kind === '"forall_apply"'
  );
  if (forall_apply_node !== undefined) {
    const proof_node = nested[0];
    const argument_node = node.children.find((child) =>
      child.kind === "prefix_proposition_term"
    );
    if (proof_node === undefined || argument_node === undefined) {
      return undefined;
    }
    const proof = proof_term_from_node(proof_node, source);
    if (proof === undefined) return undefined;
    return {
      tag: "forall_apply",
      proof,
      argument: term_from_node(argument_node, source),
      span,
    };
  }
  const exists_intro_node = node.children.find((child) =>
    child.kind === '"exists_intro"'
  );
  if (exists_intro_node !== undefined) {
    const witness_node = node.children.find((child) =>
      child.kind === "prefix_proposition_term"
    );
    const proof_node = nested[0];
    if (witness_node === undefined || proof_node === undefined) {
      return undefined;
    }
    const proof = proof_term_from_node(proof_node, source);
    if (proof === undefined) return undefined;
    return {
      tag: "exists_intro",
      witness: term_from_node(witness_node, source),
      proof,
      span,
    };
  }
  const exists_elim_node = node.children.find((child) =>
    child.kind === '"exists_elim"'
  );
  if (exists_elim_node !== undefined) {
    const names = node.children.filter((child) => child.kind === "identifier");
    const proof_node = nested[0];
    const witness_name_node = names[0];
    const evidence_name_node = names[1];
    const body_node = nested[1];
    if (
      proof_node === undefined || witness_name_node === undefined ||
      evidence_name_node === undefined || body_node === undefined
    ) {
      return undefined;
    }
    const proof = proof_term_from_node(proof_node, source);
    const body = proof_term_from_node(body_node, source);
    if (proof === undefined || body === undefined) return undefined;
    return {
      tag: "exists_elim",
      proof,
      witness_name: source.slice(
        witness_name_node.start,
        witness_name_node.end,
      ),
      evidence_name: source.slice(
        evidence_name_node.start,
        evidence_name_node.end,
      ),
      body,
      span,
    };
  }
  const congr_node = node.children.find((child) => child.kind === '"congr"');
  if (congr_node !== undefined) {
    const parameter_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    const function_node = node.children.find((child) =>
      child.kind === "prefix_proposition_term"
    );
    const proof_node = nested[0];
    if (
      parameter_node === undefined || function_node === undefined ||
      proof_node === undefined
    ) {
      return undefined;
    }
    const proof = proof_term_from_node(proof_node, source);
    if (proof === undefined) return undefined;
    return {
      tag: "congr",
      parameter_name: source.slice(parameter_node.start, parameter_node.end),
      function: term_from_node(function_node, source),
      proof,
      span,
    };
  }
  const transport_node = node.children.find((child) =>
    child.kind === '"transport"'
  );
  if (transport_node !== undefined) {
    const equality_node = nested[0];
    const motive_name_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    const motive_node = node.children.find((child) =>
      child.kind === "prefix_proposition"
    );
    const proof_node = nested[1];
    if (
      equality_node === undefined || motive_name_node === undefined ||
      motive_node === undefined || proof_node === undefined
    ) {
      return undefined;
    }
    const equality = proof_term_from_node(equality_node, source);
    const motive = proposition_from_node(motive_node, source);
    const proof = proof_term_from_node(proof_node, source);
    if (equality === undefined || motive === undefined || proof === undefined) {
      return undefined;
    }
    return {
      tag: "transport",
      equality,
      motive_name: source.slice(
        motive_name_node.start,
        motive_name_node.end,
      ),
      motive,
      proof,
      span,
    };
  }
  const arrow_node = node.children.find((child) => child.kind === '"=>"');
  if (arrow_node !== undefined) {
    const name_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    const body_node = nested[0];
    if (name_node === undefined || body_node === undefined) return undefined;
    const body = proof_term_from_node(body_node, source);
    if (body === undefined) return undefined;
    return {
      tag: "lambda",
      name: source.slice(name_node.start, name_node.end),
      body,
      span,
    };
  }
  const operator_node = node.children.find((child) =>
    child.kind === '"symm"' || child.kind === '"and_left"' ||
    child.kind === '"and_right"' || child.kind === '"trans"' ||
    child.kind === '"and_intro"' || child.kind === '"implies_apply"' ||
    child.kind === '"or_left"' || child.kind === '"or_right"' ||
    child.kind === '"false_elim"'
  );
  if (operator_node === undefined) {
    const name_node = node.children.find((child) =>
      child.kind === "identifier"
    );
    if (name_node !== undefined) {
      return {
        tag: "name",
        name: source.slice(name_node.start, name_node.end),
        span,
      };
    }
    const parenthesized = nested[0];
    if (parenthesized === undefined) return undefined;
    return proof_term_from_node(parenthesized, source);
  }
  const operator = source.slice(operator_node.start, operator_node.end);
  if (
    operator === "symm" || operator === "and_left" ||
    operator === "and_right" || operator === "or_left" ||
    operator === "or_right" || operator === "false_elim"
  ) {
    const proof_node = nested[0];
    if (proof_node === undefined) return undefined;
    const proof = proof_term_from_node(proof_node, source);
    if (proof === undefined) return undefined;
    return { tag: operator, proof, span };
  }
  if (
    operator === "trans" || operator === "and_intro" ||
    operator === "implies_apply"
  ) {
    const left_node = nested[0];
    const right_node = nested[1];
    if (left_node === undefined || right_node === undefined) return undefined;
    const left = proof_term_from_node(left_node, source);
    const right = proof_term_from_node(right_node, source);
    if (left === undefined || right === undefined) return undefined;
    return { tag: operator, left, right, span };
  }
  return undefined;
}

function canonical_type_reference(
  node: BabaCstNode,
  source: string,
): string {
  if (node.children.length === 0) {
    return source.slice(node.start, node.end);
  }
  if (node.kind === "type_application") {
    let application = "";
    for (const child of node.children) {
      if (child.kind === "comment") continue;
      if (
        application.length > 0 && child.kind !== "immediate_type_argument"
      ) {
        application += " ";
      }
      application += canonical_type_reference(child, source);
    }
    return application;
  }
  let canonical = "";
  for (const child of node.children) {
    if (child.kind === "comment") continue;
    canonical += canonical_type_reference(child, source);
  }
  return canonical;
}

function proposition_from_node(
  node: BabaCstNode,
  source: string,
): PrefixProposition | undefined {
  const span = { start: node.start, end: node.end };
  if (node.kind === "prefix_proposition") {
    const child = semantic_child(node);
    if (child === undefined) return undefined;
    return proposition_from_node(child, source);
  }
  if (node.kind === "prefix_implication_proposition") {
    const premise_node = node.children.find((child) =>
      child.kind === "prefix_disjunction_proposition"
    );
    if (premise_node === undefined) return undefined;
    const premise = proposition_from_node(premise_node, source);
    if (premise === undefined) return undefined;
    const conclusion_node = node.children.find((child) =>
      child.kind === "prefix_implication_proposition"
    );
    if (conclusion_node === undefined) return premise;
    const conclusion = proposition_from_node(conclusion_node, source);
    if (conclusion === undefined) return undefined;
    return { tag: "implies", left: premise, right: conclusion, span };
  }
  if (node.kind === "prefix_disjunction_proposition") {
    return fold_propositions(
      node,
      source,
      "prefix_conjunction_proposition",
      "or",
    );
  }
  if (node.kind === "prefix_conjunction_proposition") {
    return fold_propositions(
      node,
      source,
      "prefix_negation_proposition",
      "and",
    );
  }
  if (node.kind === "prefix_negation_proposition") {
    const proposition_node = node.children.find((child) =>
      child.kind === "prefix_negation_proposition"
    );
    if (proposition_node !== undefined) {
      const proposition = proposition_from_node(proposition_node, source);
      if (proposition === undefined) return undefined;
      return { tag: "not", proposition, span };
    }
    const child = semantic_child(node);
    if (child === undefined) return undefined;
    return proposition_from_node(child, source);
  }
  if (node.kind === "prefix_quantified_proposition") {
    const binder_node = node.children.find((child) =>
      child.kind === "prefix_proposition_binder"
    );
    const proposition_node = node.children.find((child) =>
      child.kind === "prefix_proposition"
    );
    if (binder_node === undefined || proposition_node === undefined) {
      return undefined;
    }
    const binder = parameter_from_node(binder_node, source);
    const proposition = proposition_from_node(proposition_node, source);
    if (binder === undefined || proposition === undefined) return undefined;
    let tag: "forall" | "exists" = "forall";
    if (
      node.children.some((child) => child.kind === "prefix_exists_keyword")
    ) {
      tag = "exists";
    }
    return { tag, binder, proposition, span };
  }
  if (node.kind !== "prefix_atomic_proposition") return undefined;
  const nested = node.children.find((child) =>
    child.kind === "prefix_proposition"
  );
  if (nested !== undefined) return proposition_from_node(nested, source);
  const atom_text = source.slice(node.start, node.end);
  if (atom_text === "True") return { tag: "true", span };
  if (atom_text === "False") return { tag: "false", span };
  const terms = node.children.filter((child) =>
    child.kind === "prefix_proposition_term"
  );
  const operator = node.children.find((child) =>
    child.kind === '"="' || child.kind === '"!="' || child.kind === '"<"' ||
    child.kind === '"<="' || child.kind === '"is"'
  );
  const left_node = terms[0];
  if (left_node === undefined) return undefined;
  const left = term_from_node(left_node, source);
  if (operator === undefined) return { tag: "holds", value: left, span };
  if (operator.kind === '"is"') {
    const type_node = node.children.find((child) =>
      child.kind === "type_reference" ||
      child.kind === "constructor_membership_type"
    );
    if (type_node === undefined) return undefined;
    let type = type_reference_from_node(type_node, source);
    if (type_node.kind === "constructor_membership_type") {
      const name_node = type_node.children.find((child) =>
        child.kind === "constructor_identifier"
      );
      if (name_node === undefined) return undefined;
      const name = source.slice(name_node.start, name_node.end);
      type = {
        ...type,
        canonical: "#" + name,
        expression: { tag: "atom", name },
        resolved: true,
      };
    }
    return {
      tag: "is",
      value: left,
      type,
      span,
    };
  }
  const right_node = terms[1];
  if (right_node === undefined) return undefined;
  const right = term_from_node(right_node, source);
  if (operator.kind === '"="') return { tag: "equal", left, right, span };
  if (operator.kind === '"!="') {
    return { tag: "not_equal", left, right, span };
  }
  if (operator.kind === '"<"') return { tag: "less", left, right, span };
  return { tag: "less_equal", left, right, span };
}

function fold_propositions(
  node: BabaCstNode,
  source: string,
  child_kind: string,
  tag: "and" | "or",
): PrefixProposition | undefined {
  const children = node.children.filter((child) => child.kind === child_kind);
  const first_node = children[0];
  if (first_node === undefined) return undefined;
  let result = proposition_from_node(first_node, source);
  if (result === undefined) return undefined;
  for (let index = 1; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) return undefined;
    const right = proposition_from_node(child, source);
    if (right === undefined) return undefined;
    result = {
      tag,
      left: result,
      right,
      span: { start: result.span.start, end: right.span.end },
    };
  }
  return result;
}

function term_from_node(node: BabaCstNode, source: string): PrefixTerm {
  return {
    text: source.slice(node.start, node.end),
    references: term_references(node, source),
    shape: term_shape_from_node(node, source),
    span: { start: node.start, end: node.end },
  };
}

function term_shape_from_node(
  node: BabaCstNode,
  source: string,
): PrefixTerm["shape"] {
  if (
    node.kind === "prefix_proposition_term" ||
    node.kind === "prefix_proposition_postfix_term" ||
    node.kind === "postfix_expression"
  ) {
    const child = semantic_child(node);
    if (child === undefined) return { tag: "unsupported" };
    return term_shape_from_node(child, source);
  }
  if (
    node.kind === "identifier" || node.kind === "lowercase_identifier" ||
    node.kind === "_aggregate_constructor_identifier" ||
    node.kind === "_effect_identifier_alias"
  ) {
    return {
      tag: "name",
      name: source.slice(node.start, node.end),
    };
  }
  if (node.kind === "number") return { tag: "number" };
  if (node.kind === "string") return { tag: "string" };
  if (node.kind === "character") return { tag: "character" };
  if (node.kind === "boolean") return { tag: "boolean" };
  if (node.kind === "prefix_proposition_binary_term") {
    const terms = node.children.filter((child) =>
      child.kind === "prefix_proposition_term"
    );
    const left = terms[0];
    const right = terms[1];
    const operator = node.children.find((child) =>
      child.kind === "operator_symbol"
    );
    if (left === undefined || right === undefined || operator === undefined) {
      return { tag: "unsupported" };
    }
    return {
      tag: "binary",
      operator: source.slice(operator.start, operator.end),
      left: term_from_node(left, source),
      right: term_from_node(right, source),
    };
  }
  if (node.kind === "binary_expression") {
    const operands = node.children.filter((child) =>
      child.kind !== "operator_symbol" && child.kind !== "comment"
    );
    const left = operands[0];
    const right = operands[1];
    const operator = node.children.find((child) =>
      child.kind === "operator_symbol"
    );
    if (left === undefined || right === undefined || operator === undefined) {
      return { tag: "unsupported" };
    }
    return {
      tag: "binary",
      operator: source.slice(operator.start, operator.end),
      left: term_from_node(left, source),
      right: term_from_node(right, source),
    };
  }
  if (node.kind === "prefix_proposition_unary_term") {
    const operand = node.children.find((child) =>
      child.kind === "prefix_proposition_term"
    );
    let operand_start = node.end;
    if (operand !== undefined) operand_start = operand.start;
    const operator = node.children.find((child) =>
      child.end <= operand_start &&
      child.kind !== "comment"
    );
    if (operand === undefined || operator === undefined) {
      return { tag: "unsupported" };
    }
    return {
      tag: "unary",
      operator: source.slice(operator.start, operator.end),
      operand: term_from_node(operand, source),
    };
  }
  if (node.kind === "prefix_proposition_call_term") {
    const function_node = node.children.find((child) =>
      child.kind === "prefix_proposition_postfix_term"
    );
    const arguments_node = node.children.find((child) =>
      child.kind === "prefix_proposition_call_arguments"
    );
    if (function_node === undefined || arguments_node === undefined) {
      return { tag: "unsupported" };
    }
    return {
      tag: "call",
      function: term_from_node(function_node, source),
      arguments: arguments_node.children.filter((child) =>
        child.kind === "prefix_proposition_term"
      ).map((child) => term_from_node(child, source)),
    };
  }
  if (node.kind === "prefix_proposition_field_term") {
    const object = node.children.find((child) =>
      child.kind === "prefix_proposition_postfix_term"
    );
    const field = node.children.find((child) =>
      child.kind === "identifier" ||
      source.slice(child.start, child.end) === "end"
    );
    if (object === undefined || field === undefined) {
      return { tag: "unsupported" };
    }
    return {
      tag: "field",
      object: term_from_node(object, source),
      field: source.slice(field.start, field.end),
    };
  }
  if (node.kind === "prefix_proposition_index_term") {
    const object = node.children.find((child) =>
      child.kind === "prefix_proposition_postfix_term"
    );
    if (object === undefined) return { tag: "unsupported" };
    return { tag: "index", object: term_from_node(object, source) };
  }
  if (node.kind === "prefix_proposition_parenthesized_term") {
    const value = node.children.find((child) =>
      child.kind === "prefix_proposition_term"
    );
    if (value === undefined) return { tag: "unsupported" };
    return { tag: "parenthesized", value: term_from_node(value, source) };
  }
  return { tag: "unsupported" };
}

function term_references(node: BabaCstNode, source: string): string[] {
  if (
    node.kind === "identifier" || node.kind === "lowercase_identifier"
  ) {
    return [source.slice(node.start, node.end)];
  }
  if (node.kind === "prefix_proposition_field_term") {
    const object = node.children.find((child) =>
      child.kind === "prefix_proposition_postfix_term"
    );
    if (object === undefined) return [];
    return term_references(object, source);
  }
  const references: string[] = [];
  const seen = new Set<string>();
  for (const child of node.children) {
    if (
      child.kind.startsWith('"') || child.kind === "comment" ||
      child.kind === "type_reference"
    ) {
      continue;
    }
    for (const reference of term_references(child, source)) {
      if (seen.has(reference)) continue;
      seen.add(reference);
      references.push(reference);
    }
  }
  return references;
}

function semantic_child(node: BabaCstNode): BabaCstNode | undefined {
  return node.children.find((child) =>
    !child.kind.startsWith('"') && child.kind !== "comment"
  );
}

function first_descendant(
  node: BabaCstNode,
  kind: string,
): BabaCstNode | undefined {
  if (node.kind === kind) return node;
  for (const child of node.children) {
    const found = first_descendant(child, kind);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collect_descendants(
  node: BabaCstNode,
  kind: string,
  collect: (node: BabaCstNode) => void,
): void {
  for (const child of node.children) {
    if (child.kind === kind) {
      collect(child);
      continue;
    }
    collect_descendants(child, kind, collect);
  }
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
