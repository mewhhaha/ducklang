import { expect } from "../expect.ts";
import type { BabaSourceNodeId } from "./baba_parser.ts";
import {
  SemanticIdentityAllocator,
  type SemanticOrigin,
  type ValueId,
} from "./semantic_identity.ts";
import type { RepresentationType } from "./representation_type.ts";
import { representation_equal, representation_type } from "./refinement.ts";
import type { SourceSpan } from "./syntax.ts";

export type SemanticBlockId = number & {
  readonly __semantic_block_id: unique symbol;
};
export type SemanticNodeId = number & {
  readonly __semantic_node_id: unique symbol;
};

export type SemanticOperation =
  | { tag: "constant"; value: string | number | bigint | boolean }
  | { tag: "primitive"; name: string }
  | { tag: "project"; field: string }
  | { tag: "construct"; constructor: string }
  | { tag: "call"; function_name: string }
  | { tag: "ownership_transition"; transition: string }
  | { tag: "phi"; incoming: readonly SemanticPhiInput[] };

export type SemanticPhiInput = {
  predecessor: SemanticBlockId;
  value: ValueId;
};

export type SemanticTerminator =
  | { tag: "jump"; target: SemanticBlockId }
  | {
    tag: "branch";
    condition: ValueId;
    when_true: SemanticBlockId;
    when_false: SemanticBlockId;
  }
  | { tag: "return"; value: ValueId | undefined }
  | { tag: "trap"; reason: string };

export type SemanticNode = {
  id: SemanticNodeId;
  origin: BabaSourceNodeId;
  span: SourceSpan;
  inputs: readonly ValueId[];
  outputs: readonly ValueId[];
  operation: SemanticOperation;
};

export type SemanticValue = {
  value: ValueId;
  type: RepresentationType;
  origin: SemanticOrigin;
};

export type SemanticExplicitOutput = {
  value: ValueId;
  origin: SemanticOrigin;
};

export type SemanticBlock = {
  id: SemanticBlockId;
  origin: BabaSourceNodeId | undefined;
  predecessors: readonly SemanticBlockId[];
  successors: readonly SemanticBlockId[];
  nodes: readonly SemanticNode[];
  terminator: SemanticTerminator;
};

export type SemanticCfg = {
  entry: SemanticBlockId;
  parameters: readonly ValueId[];
  values: readonly SemanticValue[];
  blocks: readonly SemanticBlock[];
};

type MutableBlock = {
  id: SemanticBlockId;
  origin: BabaSourceNodeId | undefined;
  predecessors: Set<SemanticBlockId>;
  successors: Set<SemanticBlockId>;
  nodes: SemanticNode[];
  terminator: SemanticTerminator | undefined;
};

export class SemanticCfgBuilder {
  readonly #allocator: SemanticIdentityAllocator;
  readonly #blocks: MutableBlock[] = [];
  #entry: SemanticBlockId | undefined;
  #next_node = 0;
  readonly #defined_values = new Set<ValueId>();
  readonly #parameters = new Set<ValueId>();
  readonly #values = new Map<ValueId, SemanticValue>();
  readonly #operation_ordinals = new Map<string, number>();
  readonly #phi_ordinals = new Map<BabaSourceNodeId, number>();

  constructor(namespace: string) {
    this.#allocator = new SemanticIdentityAllocator(namespace);
  }

  add_block(origin: BabaSourceNodeId | undefined): SemanticBlockId {
    const id = this.#blocks.length as SemanticBlockId;
    const block: MutableBlock = {
      id,
      origin,
      predecessors: new Set(),
      successors: new Set(),
      nodes: [],
      terminator: undefined,
    };
    this.#blocks.push(block);
    if (this.#entry === undefined) this.#entry = id;
    return id;
  }

  connect(from: SemanticBlockId, to: SemanticBlockId): void {
    const source = this.block(from);
    const target = this.block(to);
    expect(
      source.terminator === undefined,
      `CFG block ${String(from)} is already terminated.`,
    );
    source.successors.add(to);
    target.predecessors.add(from);
  }

  add_parameter(
    value: ValueId,
    type: RepresentationType,
    origin: SemanticOrigin,
  ): void {
    expect(this.#entry !== undefined, "CFG parameter needs an entry block.");
    expect(
      !this.#defined_values.has(value),
      `CFG ValueId ${String(value)} is already defined.`,
    );
    const parameter = snapshot_value(value, type, origin);
    this.#defined_values.add(value);
    this.#parameters.add(value);
    this.#values.set(value, parameter);
  }

  add_node(
    block_id: SemanticBlockId,
    origin: BabaSourceNodeId,
    span: SourceSpan,
    operation: SemanticOperation,
    inputs: readonly ValueId[],
    output_types: readonly RepresentationType[],
    explicit_outputs: readonly SemanticExplicitOutput[] = [],
  ): readonly ValueId[] {
    const block = this.block(block_id);
    expect(
      block.terminator === undefined,
      `CFG block ${String(block_id)} is already terminated.`,
    );
    expect(operation.tag !== "phi", "Use add_phi to create phi nodes.");
    expect(
      explicit_outputs.length === 0 ||
        explicit_outputs.length === output_types.length,
      "Explicit CFG outputs must match output types.",
    );
    for (const input of inputs) {
      expect(
        this.#defined_values.has(input),
        `CFG input ValueId ${String(input)} is undefined.`,
      );
    }
    const stable_span = snapshot_span(span);
    const stable_operation = snapshot_operation(operation);
    const operation_key = origin + ":" + stable_operation.tag;
    let operation_ordinal = 0;
    const previous_ordinal = this.#operation_ordinals.get(operation_key);
    if (previous_ordinal !== undefined) {
      operation_ordinal = previous_ordinal;
    }
    const stable_types = output_types.map((type) =>
      representation_type(type).representation
    );
    const outputs: ValueId[] = [];
    const pending_outputs = new Set<ValueId>();
    const pending_values: SemanticValue[] = [];
    for (let index = 0; index < stable_types.length; index += 1) {
      const explicit_output = explicit_outputs[index];
      let output: ValueId;
      let output_origin: SemanticOrigin;
      if (explicit_output === undefined) {
        output = this.#allocator.value_for(
          origin,
          "cfg:" + stable_operation.tag + ":" +
            operation_ordinal.toString() + ":" + index.toString(),
        );
        output_origin = {
          source_node: origin,
          start: stable_span.start,
          end: stable_span.end,
        };
      } else {
        output = explicit_output.value;
        output_origin = explicit_output.origin;
      }
      expect(
        !this.#defined_values.has(output) && !pending_outputs.has(output),
        `CFG ValueId ${String(output)} is already defined.`,
      );
      outputs.push(output);
      pending_outputs.add(output);
      const type = stable_types[index];
      expect(type !== undefined, "CFG output type disappeared.");
      pending_values.push(snapshot_value(output, type, output_origin));
    }
    const node: SemanticNode = Object.freeze({
      id: this.#next_node as SemanticNodeId,
      origin,
      span: stable_span,
      inputs: Object.freeze([...inputs]),
      outputs: Object.freeze(outputs),
      operation: stable_operation,
    });
    this.#operation_ordinals.set(operation_key, operation_ordinal + 1);
    this.#next_node += 1;
    block.nodes.push(node);
    for (const value of pending_values) {
      this.#defined_values.add(value.value);
      this.#values.set(value.value, value);
    }
    return node.outputs;
  }

  add_phi(
    block_id: SemanticBlockId,
    origin: BabaSourceNodeId,
    span: SourceSpan,
    incoming: ReadonlyMap<SemanticBlockId, ValueId>,
    type: RepresentationType,
    explicit_output: SemanticExplicitOutput | undefined = undefined,
  ): ValueId {
    const block = this.block(block_id);
    expect(
      block.terminator === undefined,
      `CFG block ${String(block_id)} is already terminated.`,
    );
    expect(incoming.size > 0, "CFG phi needs a live predecessor.");
    expect(
      incoming.size === block.predecessors.size,
      "CFG phi must cover every live predecessor.",
    );
    const stable_span = snapshot_span(span);
    const stable_type = representation_type(type).representation;
    for (const [predecessor, value] of incoming) {
      expect(
        block.predecessors.has(predecessor),
        `CFG phi predecessor ${String(predecessor)} is not connected to block ${
          String(block_id)
        }.`,
      );
      expect(
        this.#defined_values.has(value),
        `CFG phi ValueId ${String(value)} is undefined.`,
      );
      const incoming_value = this.#values.get(value);
      expect(
        incoming_value !== undefined &&
          representation_equal(incoming_value.type, stable_type),
        `CFG phi ValueId ${String(value)} has an incompatible type.`,
      );
    }
    const incoming_values = [...incoming].map(([predecessor, value]) => ({
      predecessor,
      value,
    }));
    let output: ValueId;
    let output_origin: SemanticOrigin;
    let phi_ordinal: number | undefined;
    if (explicit_output === undefined) {
      const previous_ordinal = this.#phi_ordinals.get(origin);
      phi_ordinal = 0;
      if (previous_ordinal !== undefined) {
        phi_ordinal = previous_ordinal;
      }
      output = this.#allocator.value_for(origin, "join:" + phi_ordinal);
      output_origin = {
        source_node: origin,
        start: stable_span.start,
        end: stable_span.end,
      };
    } else {
      output = explicit_output.value;
      output_origin = explicit_output.origin;
    }
    expect(
      !this.#defined_values.has(output),
      `CFG ValueId ${String(output)} is already defined.`,
    );
    const stable_output = snapshot_value(output, stable_type, output_origin);
    const node: SemanticNode = Object.freeze({
      id: this.#next_node as SemanticNodeId,
      origin,
      span: stable_span,
      inputs: Object.freeze(incoming_values.map((entry) => entry.value)),
      outputs: Object.freeze([output]),
      operation: Object.freeze({
        tag: "phi",
        incoming: Object.freeze(
          incoming_values.map((entry) => Object.freeze(entry)),
        ),
      }),
    });
    if (phi_ordinal !== undefined) {
      this.#phi_ordinals.set(origin, phi_ordinal + 1);
    }
    this.#next_node += 1;
    block.nodes.push(node);
    this.#defined_values.add(output);
    this.#values.set(output, stable_output);
    return output;
  }

  terminate(block_id: SemanticBlockId, terminator: SemanticTerminator): void {
    const block = this.block(block_id);
    expect(
      block.terminator === undefined,
      `CFG block ${String(block_id)} already has a terminator.`,
    );
    const stable_terminator = snapshot_terminator(terminator);
    this.validate_terminator(block, stable_terminator);
    block.terminator = stable_terminator;
  }

  finish(): SemanticCfg {
    expect(this.#entry !== undefined, "CFG needs an entry block.");
    for (const block of this.#blocks) {
      expect(
        block.terminator !== undefined,
        `CFG block ${String(block.id)} has no terminator.`,
      );
      const terminator = block.terminator;
      expect(terminator !== undefined, "CFG terminator disappeared.");
      this.validate_terminator(block, terminator);
      this.validate_phi_coverage(block);
    }
    this.validate_value_availability();
    const blocks = Object.freeze(this.#blocks.map((block) =>
      Object.freeze({
        id: block.id,
        origin: block.origin,
        predecessors: Object.freeze([...block.predecessors]),
        successors: Object.freeze([...block.successors]),
        nodes: Object.freeze([...block.nodes]),
        terminator: snapshot_terminator(block.terminator as SemanticTerminator),
      })
    ));
    return Object.freeze({
      entry: this.#entry,
      parameters: Object.freeze([...this.#parameters]),
      values: Object.freeze([...this.#values.values()]),
      blocks,
    });
  }

  private block(id: SemanticBlockId): MutableBlock {
    expect(
      typeof id === "number" && Number.isSafeInteger(id) && id >= 0,
      `Invalid CFG block ID ${String(id)}.`,
    );
    const block = this.#blocks[id];
    expect(block !== undefined, `Unknown CFG block ${String(id)}.`);
    return block;
  }

  private validate_terminator(
    block: MutableBlock,
    terminator: SemanticTerminator,
  ): void {
    switch (terminator.tag) {
      case "jump":
        this.block(terminator.target);
        expect(
          block.successors.has(terminator.target),
          "CFG jump target is not connected.",
        );
        expect(
          block.successors.size === 1,
          "CFG jump must be the only successor.",
        );
        return;
      case "branch": {
        this.block(terminator.when_true);
        this.block(terminator.when_false);
        const condition = this.#values.get(terminator.condition);
        expect(
          condition !== undefined,
          `CFG condition ValueId ${String(terminator.condition)} is undefined.`,
        );
        expect(
          representation_equal(condition.type, {
            tag: "scalar",
            name: "Bool",
          }),
          `CFG condition ValueId ${
            String(terminator.condition)
          } must have representation Bool.`,
        );
        expect(
          block.successors.has(terminator.when_true),
          "CFG true branch is not connected.",
        );
        expect(
          block.successors.has(terminator.when_false),
          "CFG false branch is not connected.",
        );
        expect(
          terminator.when_true !== terminator.when_false,
          "CFG branch arms must differ.",
        );
        expect(
          block.successors.size === 2,
          "CFG branch must have exactly two successors.",
        );
        return;
      }
      case "return":
        if (terminator.value !== undefined) {
          expect(
            this.#defined_values.has(terminator.value),
            `CFG return ValueId ${String(terminator.value)} is undefined.`,
          );
        }
        expect(
          block.successors.size === 0,
          "Terminal CFG block cannot have successors.",
        );
        return;
      case "trap":
        expect(
          block.successors.size === 0,
          "Terminal CFG block cannot have successors.",
        );
        return;
    }
  }

  private validate_value_availability(): void {
    const entry = this.#entry as SemanticBlockId;
    const available_at_entry = new Map<SemanticBlockId, Set<ValueId>>();
    const available_after_block = new Map<SemanticBlockId, Set<ValueId>>();
    for (const block of this.#blocks) {
      available_at_entry.set(block.id, new Set());
      available_after_block.set(block.id, new Set());
    }
    let changed = true;
    let iterations = 0;
    while (changed) {
      changed = false;
      iterations += 1;
      expect(
        iterations <= this.#blocks.length * (this.#defined_values.size + 1) + 1,
        "CFG value availability did not stabilize.",
      );
      for (const block of this.#blocks) {
        const incoming = new Set<ValueId>();
        if (block.id === entry) {
          for (const parameter of this.#parameters) {
            incoming.add(parameter);
          }
        } else if (block.predecessors.size > 0) {
          const predecessor_values = [...block.predecessors].map((
            predecessor,
          ) => available_after_block.get(predecessor) as Set<ValueId>);
          const first = predecessor_values[0];
          if (first !== undefined) {
            for (const value of first) {
              if (predecessor_values.every((values) => values.has(value))) {
                incoming.add(value);
              }
            }
          }
        }
        const previous_entry = available_at_entry.get(block.id) as Set<ValueId>;
        if (!same_values(previous_entry, incoming)) {
          available_at_entry.set(block.id, incoming);
          changed = true;
        }
        const after = new Set(incoming);
        for (const node of block.nodes) {
          if (node.operation.tag === "phi") {
            // Phi inputs are checked after availability reaches a fixed point.
          } else {
            for (const input of node.inputs) {
              expect(
                after.has(input),
                `CFG ValueId ${String(input)} is unavailable on block ${
                  String(block.id)
                }.`,
              );
            }
          }
          for (const output of node.outputs) after.add(output);
        }
        const previous_after = available_after_block.get(block.id) as Set<
          ValueId
        >;
        if (!same_values(previous_after, after)) {
          available_after_block.set(block.id, after);
          changed = true;
        }
        const terminator = block.terminator as SemanticTerminator;
        if (terminator.tag === "branch" && !after.has(terminator.condition)) {
          throw new Error(
            `CFG ValueId ${
              String(terminator.condition)
            } is unavailable on block ${String(block.id)}.`,
          );
        }
        if (
          terminator.tag === "return" && terminator.value !== undefined &&
          !after.has(terminator.value)
        ) {
          throw new Error(
            `CFG ValueId ${String(terminator.value)} is unavailable on block ${
              String(block.id)
            }.`,
          );
        }
      }
    }
    for (const block of this.#blocks) {
      for (const node of block.nodes) {
        if (node.operation.tag !== "phi") continue;
        for (const entry of node.operation.incoming) {
          const predecessor_values = available_after_block.get(
            entry.predecessor,
          );
          expect(
            predecessor_values !== undefined &&
              predecessor_values.has(entry.value),
            `CFG phi ValueId ${
              String(entry.value)
            } is unavailable on predecessor ${String(entry.predecessor)}.`,
          );
        }
      }
    }
  }

  private validate_phi_coverage(block: MutableBlock): void {
    for (const node of block.nodes) {
      if (node.operation.tag !== "phi") continue;
      expect(
        node.operation.incoming.length === block.predecessors.size,
        `CFG phi in block ${
          String(block.id)
        } must cover every live predecessor.`,
      );
      const predecessors = new Set<SemanticBlockId>();
      for (const entry of node.operation.incoming) {
        expect(
          block.predecessors.has(entry.predecessor) &&
            !predecessors.has(entry.predecessor),
          `CFG phi has an invalid predecessor ${String(entry.predecessor)}.`,
        );
        predecessors.add(entry.predecessor);
      }
    }
  }
}

function same_values(
  left: ReadonlySet<ValueId>,
  right: ReadonlySet<ValueId>,
): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function snapshot_value(
  value: ValueId,
  type: RepresentationType,
  origin: SemanticOrigin,
): SemanticValue {
  const stable_type = representation_type(type).representation;
  const span = snapshot_span(origin);
  return Object.freeze({
    value,
    type: stable_type,
    origin: Object.freeze({
      source_node: origin.source_node,
      start: span.start,
      end: span.end,
    }),
  });
}

function snapshot_span(span: SourceSpan): SourceSpan {
  expect(
    Number.isSafeInteger(span.start) && span.start >= 0,
    "CFG source span start is invalid.",
  );
  expect(
    Number.isSafeInteger(span.end) && span.end >= span.start,
    "CFG source span end is invalid.",
  );
  return Object.freeze({ start: span.start, end: span.end });
}

function snapshot_operation(operation: SemanticOperation): SemanticOperation {
  switch (operation.tag) {
    case "constant":
      expect(
        is_constant_value(operation.value),
        "CFG constants must be primitive values.",
      );
      return Object.freeze({ tag: "constant", value: operation.value });
    case "primitive":
      return Object.freeze({
        tag: "primitive",
        name: required_text(operation.name),
      });
    case "project":
      return Object.freeze({
        tag: "project",
        field: required_text(operation.field),
      });
    case "construct":
      return Object.freeze({
        tag: "construct",
        constructor: required_text(operation.constructor),
      });
    case "call":
      return Object.freeze({
        tag: "call",
        function_name: required_text(operation.function_name),
      });
    case "ownership_transition":
      return Object.freeze({
        tag: "ownership_transition",
        transition: required_text(operation.transition),
      });
    case "phi":
      return Object.freeze({
        tag: "phi",
        incoming: Object.freeze(
          operation.incoming.map((entry) =>
            Object.freeze({
              predecessor: entry.predecessor,
              value: entry.value,
            })
          ),
        ),
      });
    default:
      throw new Error("Invalid CFG operation tag.");
  }
}

function snapshot_terminator(
  terminator: SemanticTerminator,
): SemanticTerminator {
  switch (terminator.tag) {
    case "jump":
      return Object.freeze({ tag: "jump", target: terminator.target });
    case "branch":
      return Object.freeze({
        tag: "branch",
        condition: terminator.condition,
        when_true: terminator.when_true,
        when_false: terminator.when_false,
      });
    case "return":
      return Object.freeze({ tag: "return", value: terminator.value });
    case "trap":
      return Object.freeze({
        tag: "trap",
        reason: required_text(terminator.reason),
      });
    default:
      throw new Error("Invalid CFG terminator tag.");
  }
}

function is_constant_value(
  value: unknown,
): value is string | number | bigint | boolean {
  return typeof value === "string" || typeof value === "number" ||
    typeof value === "bigint" || typeof value === "boolean";
}

function required_text(value: string): string {
  expect(
    typeof value === "string" && value.length > 0,
    "CFG text must not be empty.",
  );
  return value;
}
