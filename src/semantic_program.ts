import type { Core } from "./core/ast.ts";
import { core_from_source } from "./core/from_source.ts";
import {
  compiler_diagnostic,
  type CompilerDiagnostic,
  CompilerDiagnosticError,
  diagnostic_codes,
  diagnostic_sequence,
} from "./diagnostic.ts";
import { expect } from "./expect.ts";
import {
  type Checked,
  checked_value,
  diagnostics_of,
  fail,
} from "./frontend/checked.ts";
import {
  type BabaCstNode,
  type BabaParseResult,
  is_trusted_baba_parse_result,
} from "./frontend/baba_parser.ts";
import type { Source as SourceNode } from "./frontend/ast.ts";
import {
  analyze_baba_semantics,
  type BabaSemanticAnalyzeOptions,
} from "./frontend/baba_analyze.ts";
import {
  type BindingIndex,
  build_binding_index,
  type EntityId,
} from "./frontend/binding_index.ts";
import { lower_baba_source } from "./frontend/baba_lower.ts";
import { check_source_for_gpufuck } from "./frontend/gpufuck_pipeline.ts";
import { source_with_host_interface } from "./frontend/host_interface.ts";
import type { SourceDiagnostic } from "./frontend/semantic_diagnostic.ts";
import type { SemanticCfg } from "./frontend/semantic_cfg.ts";
import { semantic_cfg_from_source } from "./frontend/semantic_cfg_lower.ts";
import {
  mark_source_span,
  mark_source_syntax,
  type SourceSpan,
  type SourceSyntax,
  type SyntaxDiagnostic,
} from "./frontend/syntax.ts";
import {
  baba_source_syntax,
  record_baba_source_name_sites,
} from "./frontend/source_parse.ts";
import {
  SemanticIdentityAllocator,
  type SemanticOrigin,
  type ValueId,
} from "./frontend/semantic_identity.ts";
import {
  type RepresentationType,
  snapshot_representation_type,
} from "./frontend/representation_type.ts";
import type { FactState } from "./frontend/fact_graph.ts";
import type { KernelCertificate } from "./frontend/proof_kernel.ts";
import type { FunctionFactSummary } from "./frontend/function_summary.ts";
import {
  associate_prefix_signatures,
  type PrefixDefinition,
  type PrefixSignature,
} from "./frontend/prefix_signature.ts";
import { extract_prefix_source_metadata } from "./frontend/prefix_signature_source.ts";

export type SemanticSymbolIndex = ReadonlyMap<string, readonly ValueId[]>;
export type SemanticTypeIndex = ReadonlyMap<ValueId, RepresentationType>;
export type RefinementIndex = ReadonlyMap<ValueId, FactState>;
export type KernelCertificateIndex = ReadonlyMap<string, KernelCertificate>;
export type SourceOriginIndex = ReadonlyMap<ValueId, SemanticOrigin>;
export type FunctionFactIndex = ReadonlyMap<string, FunctionFactSummary>;

export type DuckSourceAnalysis = {
  source: SourceNode;
  syntax: SourceSyntax;
  syntax_diagnostics: SyntaxDiagnostic[];
  diagnostics: SourceDiagnostic[];
};

export type DuckAnalysis = {
  parsed: BabaParseResult;
  source: SourceNode;
  source_analysis: DuckSourceAnalysis;
  diagnostics: readonly SourceDiagnostic[];
  control_flow: SemanticCfg | undefined;
  symbols: SemanticSymbolIndex;
  types: SemanticTypeIndex;
  facts: RefinementIndex;
  proofs: KernelCertificateIndex;
  origins: SourceOriginIndex;
  function_summaries: FunctionFactIndex;
};

export type DuckSemanticProgram = {
  core: Core;
  symbols: SemanticSymbolIndex;
  types: SemanticTypeIndex;
  facts: RefinementIndex;
  proofs: KernelCertificateIndex;
  origins: SourceOriginIndex;
  function_summaries: FunctionFactIndex;
};

export type DuckAnalyzeOptions = BabaSemanticAnalyzeOptions & {
  host_interface?: SourceNode;
  uri?: string;
};

class FrozenMap<Key, Value> implements ReadonlyMap<Key, Value> {
  readonly #entries: Map<Key, Value>;

  constructor(entries: Iterable<readonly [Key, Value]>) {
    this.#entries = new Map(entries);
    Object.freeze(this);
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: Key): Value | undefined {
    return this.#entries.get(key);
  }

  has(key: Key): boolean {
    return this.#entries.has(key);
  }

  entries(): MapIterator<[Key, Value]> {
    return this.#entries.entries();
  }

  keys(): MapIterator<Key> {
    return this.#entries.keys();
  }

  values(): MapIterator<Value> {
    return this.#entries.values();
  }

  forEach(
    callback: (value: Value, key: Key, map: ReadonlyMap<Key, Value>) => void,
  ): void {
    this.#entries.forEach((value, key) => callback(value, key, this));
  }

  [Symbol.iterator](): MapIterator<[Key, Value]> {
    return this.entries();
  }
}

export function analyze_duck_source(
  parsed: BabaParseResult,
  options: DuckAnalyzeOptions = {},
): DuckAnalysis {
  const stable_input = snapshot_baba_parse_result(parsed);
  const source_metadata = extract_prefix_source_metadata(stable_input);
  const lowering = lower_baba_source(stable_input);
  const lowering_diagnostics = diagnostics_of(lowering);
  let source = checked_value(lowering);
  if (source === undefined) {
    source = { tag: "program", statements: [] };
    mark_source_span(source, { start: 0, end: stable_input.cst.text.length });
  }
  const syntax = baba_source_syntax(stable_input);
  mark_source_syntax(source, syntax);
  record_baba_source_name_sites(source, syntax);
  let analysis_source = source;
  if (options.host_interface !== undefined) {
    analysis_source = source_with_host_interface(
      analysis_source,
      options.host_interface,
    );
  }
  let semantic_diagnostics: SourceDiagnostic[] = [];
  if (
    stable_input.diagnostics.length === 0 &&
    lowering_diagnostics.length === 0
  ) {
    semantic_diagnostics = analyze_baba_semantics(
      analysis_source,
      options,
    );
  }
  const source_analysis: DuckSourceAnalysis = {
    source: analysis_source,
    syntax,
    syntax_diagnostics: [...stable_input.diagnostics],
    diagnostics: diagnostic_sequence(semantic_diagnostics, options.uri),
  };
  const prefix_signatures: PrefixSignature[] = [...source_metadata.signatures];
  const prefix_definitions: PrefixDefinition[] = [
    ...source_metadata.definitions,
  ];
  // Definitions are syntax-owned. Caller-supplied metadata must not be able
  // to manufacture a matching definition and suppress a source diagnostic.
  const signature_diagnostics = diagnostics_of(
    associate_prefix_signatures(
      prefix_signatures,
      prefix_definitions,
    ),
  );
  const contract_diagnostics = validate_prefix_contracts(
    prefix_signatures,
    prefix_definitions,
    stable_input.cst.text,
  );
  const identity = new SemanticIdentityAllocator("duck-program");
  const binding_index = build_binding_index({
    source: source_analysis.source,
    syntax,
    recovery_intervals: stable_input.recovery_intervals,
  });
  const symbols = new Map<string, ValueId[]>();
  const types = new Map<ValueId, RepresentationType>();
  const origins = new Map<ValueId, SemanticOrigin>();
  const binding_values = collect_semantic_bindings(
    binding_index,
    stable_input.cst.root,
    identity,
    symbols,
    types,
    origins,
  );
  const diagnostics = diagnostic_sequence([
    ...stable_input.diagnostics.map((diagnostic) =>
      compiler_diagnostic(
        diagnostic_codes.syntax_error,
        diagnostic.message,
        diagnostic.span,
      )
    ),
    ...source_analysis.diagnostics,
    ...lowering_diagnostics,
    ...signature_diagnostics,
    ...contract_diagnostics,
  ], options.uri);
  let control_flow: SemanticCfg | undefined;
  if (!has_error_diagnostics(diagnostics)) {
    control_flow = semantic_cfg_from_source(
      source_analysis.source,
      stable_input.cst.root,
      binding_index,
      binding_values,
      origins,
    );
  }
  return {
    parsed: stable_input,
    source: source_analysis.source,
    source_analysis,
    diagnostics,
    control_flow,
    symbols: freeze_symbol_index(symbols),
    types: new FrozenMap(types),
    facts: new FrozenMap([]),
    proofs: new FrozenMap([]),
    origins: new FrozenMap(origins),
    function_summaries: new FrozenMap([]),
  };
}

function validate_prefix_contracts(
  signatures: readonly PrefixSignature[],
  definitions: readonly PrefixDefinition[],
  source_text: string,
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  for (const signature of signatures) {
    for (const ensures of signature.ensures) {
      const equality = ensures.match(/^result\s*=\s*([A-Za-z][A-Za-z0-9_]*)$/);
      if (equality === null) {
        if (ensures.trim() === "true" || ensures.trim() === "false") continue;
        diagnostics.push(
          compiler_diagnostic(
            diagnostic_codes.prefix_signature_unproved,
            `Prefix signature ${signature.name} uses an unsupported ensures proposition: ${ensures}.`,
            signature.span,
          ),
        );
        continue;
      }
      const metadata_definition = definitions.find((definition) =>
        definition.name === signature.name &&
        definition.scope === signature.scope &&
        definition.span.start >= signature.span.end
      );
      if (metadata_definition === undefined) continue;
      const definition_text = source_text.slice(
        metadata_definition.span.start,
        metadata_definition.span.end,
      );
      const signature_parameters: string[] = [];
      const arrow_index = signature.type_text.indexOf("->");
      let parameter_group = "";
      if (arrow_index >= 0) {
        const parameter_prefix = signature.type_text.slice(0, arrow_index);
        let depth = 0;
        let group_start = -1;
        for (let index = 0; index < parameter_prefix.length; index += 1) {
          const character = parameter_prefix[index];
          if (character === "(") {
            if (depth === 0) group_start = index;
            depth += 1;
          }
          if (character === ")") {
            depth -= 1;
            if (depth === 0 && group_start >= 0) {
              parameter_group = parameter_prefix.slice(group_start + 1, index);
              group_start = -1;
            }
          }
        }
      }
      const parameter_pattern = /(?:^|,)\s*([A-Za-z][A-Za-z0-9_]*)\s*:/g;
      let parameter_match: RegExpExecArray | null;
      while (
        (parameter_match = parameter_pattern.exec(parameter_group)) !== null
      ) {
        const parameter_name = parameter_match[1];
        if (parameter_name !== undefined) {
          signature_parameters.push(parameter_name);
        }
      }
      const lambda = definition_text.match(
        /=\s*(?:\(([^)]*)\)|([A-Za-z][A-Za-z0-9_]*))\s*=>\s*([A-Za-z][A-Za-z0-9_]*)\s*;?\s*$/,
      );
      let establishes = false;
      if (lambda !== null) {
        let lambda_parameter_text = lambda[1];
        if (lambda_parameter_text === undefined) {
          lambda_parameter_text = lambda[2];
        }
        if (lambda_parameter_text === undefined) lambda_parameter_text = "";
        const lambda_parameters = lambda_parameter_text.split(",").map((
          parameter,
        ) => parameter.trim()).filter((parameter) => parameter.length > 0);
        const result_name = lambda[3];
        const expected_index = signature_parameters.indexOf(equality[1]);
        if (
          result_name !== undefined && expected_index >= 0 &&
          lambda_parameters[expected_index] === result_name
        ) {
          establishes = true;
        }
      }
      if (establishes) continue;
      diagnostics.push(
        compiler_diagnostic(
          diagnostic_codes.prefix_signature_unproved,
          `Prefix signature ${signature.name} does not establish ensures ${ensures}.`,
          signature.span,
        ),
      );
    }
  }
  return diagnostics;
}

function freeze_symbol_index(
  symbols: Map<string, ValueId[]>,
): SemanticSymbolIndex {
  const entries: [string, readonly ValueId[]][] = [];
  symbols.forEach((values, name) => {
    entries.push([name, Object.freeze([...values])]);
  });
  return new FrozenMap(entries);
}

function snapshot_baba_parse_result(parsed: BabaParseResult): BabaParseResult {
  expect(
    is_trusted_baba_parse_result(parsed),
    "Baba parse result is not trusted by the parser boundary.",
  );
  expect(
    parsed !== null && typeof parsed === "object",
    "Baba parse result must be an object.",
  );
  require_own_data(parsed, "tokens");
  require_own_data(parsed, "diagnostics");
  require_own_data(parsed, "recovery_intervals");
  require_own_data(parsed, "cst");
  expect(
    typeof parsed.cst === "object" && parsed.cst !== null,
    "Baba CST must be an object.",
  );
  require_own_data(parsed.cst, "text");
  require_own_data(parsed.cst, "tree");
  require_own_data(parsed.cst, "root");
  expect(
    typeof parsed.cst.text === "string",
    "Baba CST text must be a string.",
  );
  expect(
    typeof parsed.cst.tree === "string",
    "Baba CST tree must be a string.",
  );
  assert_plain_array(parsed.tokens, "Baba tokens");
  assert_plain_array(parsed.diagnostics, "Baba diagnostics");
  assert_plain_array(
    parsed.recovery_intervals,
    "Baba recovery intervals",
  );
  let root: BabaCstNode | undefined;
  if (parsed.cst.root !== undefined) {
    root = snapshot_cst_node(
      parsed.cst.root,
      new WeakSet<object>(),
      new WeakSet<object>(),
      new Set<string>(),
      parsed.cst.text.length,
    );
  } else {
    expect(
      parsed.cst.text.trim().length === 0,
      "Non-empty Baba input must have a CST root.",
    );
  }
  if (root !== undefined) {
    expect(
      root.start === 0 && root.end === parsed.cst.text.length,
      "Baba CST root must cover the complete source.",
    );
  }
  const tokens: BabaParseResult["tokens"] = [];
  for (let index = 0; index < parsed.tokens.length; index += 1) {
    const token = parsed.tokens[index];
    expect(token !== undefined, "Baba token list cannot contain holes.");
    require_own_data(token, "kind");
    require_own_data(token, "text");
    require_own_data(token, "start");
    require_own_data(token, "end");
    expect(
      typeof token.kind === "string" && token.kind.length > 0,
      "Baba token kind must be a non-empty string.",
    );
    expect(
      Number.isSafeInteger(token.start) && token.start >= 0 &&
        token.start <= parsed.cst.text.length,
      "Baba token start is outside source text.",
    );
    expect(
      Number.isSafeInteger(token.end) && token.end >= token.start &&
        token.end <= parsed.cst.text.length,
      "Baba token end is outside source text.",
    );
    tokens.push(
      Object.freeze({
        kind: token.kind,
        text: token.text,
        start: token.start,
        end: token.end,
      }),
    );
  }
  const diagnostics: BabaParseResult["diagnostics"] = [];
  for (let index = 0; index < parsed.diagnostics.length; index += 1) {
    const diagnostic = parsed.diagnostics[index];
    expect(diagnostic !== undefined, "Baba diagnostics cannot contain holes.");
    require_own_data(diagnostic, "message");
    require_own_data(diagnostic, "span");
    require_own_data(diagnostic.span, "start");
    require_own_data(diagnostic.span, "end");
    expect(
      Number.isSafeInteger(diagnostic.span.start) &&
        diagnostic.span.start >= 0 &&
        diagnostic.span.start <= parsed.cst.text.length,
      "Baba diagnostic start is outside source text.",
    );
    expect(
      Number.isSafeInteger(diagnostic.span.end) &&
        diagnostic.span.end >= diagnostic.span.start &&
        diagnostic.span.end <= parsed.cst.text.length,
      "Baba diagnostic end is outside source text.",
    );
    diagnostics.push(Object.freeze({
      message: diagnostic.message,
      span: Object.freeze({
        start: diagnostic.span.start,
        end: diagnostic.span.end,
      }),
    }));
  }
  const diagnostic_snapshots = new Map<SyntaxDiagnostic, SyntaxDiagnostic>();
  for (let index = 0; index < parsed.diagnostics.length; index += 1) {
    const source_diagnostic = parsed.diagnostics[index];
    const diagnostic = diagnostics[index];
    expect(
      source_diagnostic !== undefined && diagnostic !== undefined,
      "Baba diagnostic snapshot disappeared.",
    );
    diagnostic_snapshots.set(source_diagnostic, diagnostic);
  }
  const recovery_nodes = new Map<string, BabaCstNode>();
  collect_cst_recovery_nodes(root, recovery_nodes);
  const recovery_intervals: BabaParseResult["recovery_intervals"] = [];
  for (
    let index = 0;
    index < parsed.recovery_intervals.length;
    index += 1
  ) {
    const interval = parsed.recovery_intervals[index];
    expect(
      interval !== undefined,
      "Baba recovery intervals cannot contain holes.",
    );
    require_own_data(interval, "diagnostic");
    require_own_data(interval, "skipped");
    require_own_data(interval, "source_node_id");
    require_own_data(interval.diagnostic, "message");
    require_own_data(interval.diagnostic, "span");
    require_own_data(interval.diagnostic.span, "start");
    require_own_data(interval.diagnostic.span, "end");
    require_own_data(interval.skipped, "start");
    require_own_data(interval.skipped, "end");
    expect(
      Number.isSafeInteger(interval.skipped.start) &&
        interval.skipped.start >= 0 &&
        interval.skipped.start <= parsed.cst.text.length,
      "Baba recovery interval start is outside source text.",
    );
    expect(
      Number.isSafeInteger(interval.skipped.end) &&
        interval.skipped.end >= interval.skipped.start &&
        interval.skipped.end <= parsed.cst.text.length,
      "Baba recovery interval end is outside source text.",
    );
    const diagnostic = diagnostic_snapshots.get(interval.diagnostic);
    expect(
      diagnostic !== undefined,
      "Baba recovery interval must reference a parser diagnostic.",
    );
    const recovery_node = recovery_nodes.get(interval.source_node_id);
    expect(
      recovery_node !== undefined,
      "Baba recovery interval must reference a CST node.",
    );
    expect(
      interval.skipped.start === recovery_node.start &&
        interval.skipped.end === recovery_node.end,
      "Baba recovery interval must match its CST recovery node.",
    );
    expect(
      diagnostic.span.start === interval.skipped.start &&
        diagnostic.span.end === interval.skipped.end,
      "Baba recovery interval must match its parser diagnostic.",
    );
    recovery_intervals.push(Object.freeze({
      diagnostic,
      skipped: Object.freeze({
        start: interval.skipped.start,
        end: interval.skipped.end,
      }),
      source_node_id: interval.source_node_id,
    }));
  }
  return Object.freeze({
    tokens: Object.freeze(tokens),
    diagnostics: Object.freeze(diagnostics),
    recovery_intervals: Object.freeze(recovery_intervals),
    cst: Object.freeze({
      text: parsed.cst.text,
      tree: parsed.cst.tree,
      root,
    }),
  }) as unknown as BabaParseResult;
}

function collect_cst_recovery_nodes(
  node: BabaCstNode | undefined,
  nodes: Map<string, BabaCstNode>,
): void {
  if (node === undefined) return;
  if (node.kind === "ERROR" || node.kind === "MISSING") {
    nodes.set(node.id, node);
  }
  for (const child of node.children) {
    collect_cst_recovery_nodes(child, nodes);
  }
}

function snapshot_cst_node(
  node: BabaCstNode,
  active: WeakSet<object>,
  seen: WeakSet<object>,
  ids: Set<string>,
  source_length: number,
  depth = 0,
): BabaCstNode {
  expect(depth <= 4096, "Baba CST is too deep.");
  expect(
    node !== null && typeof node === "object",
    "Baba CST node must be an object.",
  );
  require_own_data(node, "id");
  require_own_data(node, "kind");
  require_own_data(node, "start");
  require_own_data(node, "end");
  require_own_data(node, "children");
  expect(
    typeof node.id === "string" && node.id.length > 0,
    "Baba CST node ID must not be empty.",
  );
  expect(!ids.has(node.id), `Duplicate Baba CST node ID ${node.id}.`);
  ids.add(node.id);
  expect(typeof node.kind === "string", "Baba CST node kind must be a string.");
  expect(
    Number.isSafeInteger(node.start) && node.start >= 0,
    "Baba CST node start must be a nonnegative integer.",
  );
  expect(
    Number.isSafeInteger(node.end) && node.end >= node.start,
    "Baba CST node end must follow start.",
  );
  expect(node.end <= source_length, "Baba CST node exceeds source text.");
  assert_plain_array(node.children, "Baba CST children");
  expect(!active.has(node), "Cyclic Baba CST node.");
  expect(!seen.has(node), "Baba CST node is shared by multiple parents.");
  active.add(node);
  seen.add(node);
  const children: BabaCstNode[] = [];
  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index];
    expect(child !== undefined, "Baba CST children cannot contain holes.");
    children.push(
      snapshot_cst_node(child, active, seen, ids, source_length, depth + 1),
    );
  }
  active.delete(node);
  return Object.freeze({
    id: node.id,
    kind: node.kind,
    start: node.start,
    end: node.end,
    children: Object.freeze(children),
  }) as unknown as BabaCstNode;
}

function require_own_data(value: object, key: string): void {
  expect(
    Object.prototype.hasOwnProperty.call(value, key),
    `Missing Baba property ${key}.`,
  );
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  expect(
    descriptor !== undefined && descriptor.get === undefined &&
      descriptor.set === undefined,
    `Baba property ${key} must be an own data property.`,
  );
}

function assert_plain_array(value: readonly unknown[], label: string): void {
  expect(Array.isArray(value), `${label} must be an array.`);
  expect(
    Object.getPrototypeOf(value) === Array.prototype,
    `${label} must be an ordinary array.`,
  );
  const keys = Reflect.ownKeys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    expect(
      key !== undefined && typeof key === "string",
      `${label} cannot contain symbol properties.`,
    );
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    expect(
      descriptor !== undefined && descriptor.get === undefined &&
        descriptor.set === undefined,
      `${label} cannot contain accessor properties.`,
    );
  }
  for (let index = 0; index < value.length; index += 1) {
    expect(
      Object.getOwnPropertyDescriptor(value, String(index)) !== undefined,
      `${label} cannot contain holes.`,
    );
  }
}

export function lower_duck_source(
  analysis: DuckAnalysis,
): Checked<DuckSemanticProgram> {
  if (has_error_diagnostics(analysis.diagnostics)) {
    return fail(...analysis.diagnostics);
  }
  try {
    return check_source_for_gpufuck(analysis.source).map((source) => {
      const core = core_from_source(source);
      return {
        core,
        symbols: analysis.symbols,
        types: analysis.types,
        facts: analysis.facts,
        proofs: analysis.proofs,
        origins: analysis.origins,
        function_summaries: analysis.function_summaries,
      };
    });
  } catch (error) {
    if (error instanceof CompilerDiagnosticError) {
      return fail(error.diagnostic);
    }
    throw error;
  }
}

function collect_semantic_bindings(
  binding_index: BindingIndex,
  root: BabaCstNode | undefined,
  identity: SemanticIdentityAllocator,
  symbols: Map<string, ValueId[]>,
  types: Map<ValueId, RepresentationType>,
  origins: Map<ValueId, SemanticOrigin>,
): Map<EntityId, ValueId> {
  const binding_values = new Map<EntityId, ValueId>();
  for (const entity of binding_index.entities.values()) {
    if (
      (entity.kind !== "value" && entity.kind !== "const" &&
        entity.kind !== "parameter" && entity.kind !== "module_parameter") ||
      entity.owner !== undefined
    ) {
      continue;
    }
    let definition_span: SourceSpan | undefined;
    if (entity.definition !== undefined) {
      const occurrence = binding_index.occurrences.get(entity.definition);
      expect(
        occurrence !== undefined,
        `Semantic binding ${entity.id} lost its definition occurrence.`,
      );
      definition_span = occurrence.span;
    }
    const cst_node = find_covering_node(root, definition_span);
    let value: ValueId;
    if (cst_node === undefined || definition_span === undefined) {
      value = identity.allocate_value();
    } else {
      value = identity.value_for(
        cst_node.id,
        "binding:" + entity.kind + ":" + entity.name + ":" +
          entity.generation.toString(),
      );
      origins.set(
        value,
        Object.freeze({
          source_node: cst_node.id,
          start: definition_span.start,
          end: definition_span.end,
        }),
      );
    }
    binding_values.set(entity.id, value);
    if (entity.definition !== undefined) {
      const values = symbols.get(entity.name);
      if (values === undefined) {
        symbols.set(entity.name, [value]);
      } else {
        values.push(value);
      }
    }
    const representation = binding_index.facts.get(entity.id)?.representation;
    if (representation !== undefined) {
      types.set(value, snapshot_representation_type(representation));
    }
  }
  return binding_values;
}

function find_covering_node(
  node: BabaCstNode | undefined,
  span: SourceSpan | undefined,
): BabaCstNode | undefined {
  if (
    node === undefined || span === undefined ||
    node.start > span.start || node.end < span.end
  ) {
    return undefined;
  }
  let best: BabaCstNode = node;
  for (const child of node.children) {
    const candidate = find_covering_node(child, span);
    if (
      candidate !== undefined &&
      candidate.end - candidate.start < best.end - best.start
    ) {
      best = candidate;
    }
  }
  return best;
}

function has_error_diagnostics(
  diagnostics: readonly SourceDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
