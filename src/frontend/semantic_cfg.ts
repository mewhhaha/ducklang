import { expect } from "../expect.ts";
import type { BabaSourceNodeId } from "./baba_parser.ts";
import {
  SemanticIdentityAllocator,
  type ValueId,
} from "./semantic_identity.ts";

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
  inputs: readonly ValueId[];
  outputs: readonly ValueId[];
  operation: SemanticOperation;
};

export type SemanticBlock = {
  id: SemanticBlockId;
  origin: BabaSourceNodeId;
  predecessors: readonly SemanticBlockId[];
  successors: readonly SemanticBlockId[];
  nodes: readonly SemanticNode[];
  terminator: SemanticTerminator;
};

export type SemanticCfg = {
  entry: SemanticBlockId;
  blocks: readonly SemanticBlock[];
};

type MutableBlock = {
  id: SemanticBlockId;
  origin: BabaSourceNodeId;
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

  constructor(namespace: string) {
    this.#allocator = new SemanticIdentityAllocator(namespace);
  }

  add_block(origin: BabaSourceNodeId): SemanticBlockId {
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

  add_node(
    block_id: SemanticBlockId,
    origin: BabaSourceNodeId,
    operation: SemanticOperation,
    inputs: readonly ValueId[],
    output_count: number,
  ): readonly ValueId[] {
    const block = this.block(block_id);
    expect(
      block.terminator === undefined,
      `CFG block ${String(block_id)} is already terminated.`,
    );
    expect(
      Number.isSafeInteger(output_count) && output_count >= 0,
      "Invalid CFG output count.",
    );
    expect(operation.tag !== "phi", "Use add_phi to create phi nodes.");
    const outputs: ValueId[] = [];
    for (const input of inputs) {
      expect(
        this.#defined_values.has(input),
        `CFG input ValueId ${String(input)} is undefined.`,
      );
    }
    const stable_operation = snapshot_operation(operation);
    for (let index = 0; index < output_count; index += 1) {
      outputs.push(
        this.#allocator.bind(
          `node_${this.#next_node}_${index}`,
          origin,
        ).value,
      );
    }
    const node: SemanticNode = Object.freeze({
      id: this.#next_node as SemanticNodeId,
      origin,
      inputs: Object.freeze([...inputs]),
      outputs: Object.freeze(outputs),
      operation: stable_operation,
    });
    this.#next_node += 1;
    block.nodes.push(node);
    for (const output of outputs) this.#defined_values.add(output);
    return node.outputs;
  }

  add_phi(
    block_id: SemanticBlockId,
    origin: BabaSourceNodeId,
    incoming: ReadonlyMap<SemanticBlockId, ValueId>,
  ): ValueId {
    const block = this.block(block_id);
    expect(incoming.size > 0, "CFG phi needs a live predecessor.");
    expect(
      incoming.size === block.predecessors.size,
      "CFG phi must cover every live predecessor.",
    );
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
    }
    const incoming_values = [...incoming].map(([predecessor, value]) => ({
      predecessor,
      value,
    }));
    const stable_incoming = new Map<string, ValueId>();
    for (const { predecessor, value } of incoming_values) {
      stable_incoming.set(String(predecessor), value);
    }
    const output =
      this.#allocator.phi(stable_incoming, semantic_origin(origin), "join")
        .value;
    const node: SemanticNode = Object.freeze({
      id: this.#next_node as SemanticNodeId,
      origin,
      inputs: Object.freeze(incoming_values.map((entry) => entry.value)),
      outputs: Object.freeze([output]),
      operation: Object.freeze({
        tag: "phi",
        incoming: Object.freeze(
          incoming_values.map((entry) => Object.freeze(entry)),
        ),
      }),
    });
    this.#next_node += 1;
    block.nodes.push(node);
    this.#defined_values.add(output);
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
    return Object.freeze({ entry: this.#entry, blocks });
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
      case "branch":
        this.block(terminator.when_true);
        this.block(terminator.when_false);
        expect(
          this.#defined_values.has(terminator.condition),
          `CFG condition ValueId ${String(terminator.condition)} is undefined.`,
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
        if (block.id !== entry && block.predecessors.size > 0) {
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

function semantic_origin(origin: BabaSourceNodeId): {
  source_node: BabaSourceNodeId;
  start: number;
  end: number;
} {
  const parts = origin.split(":");
  const start_text = parts[parts.length - 3];
  const end_text = parts[parts.length - 2];
  let start = 0;
  let end = 0;
  if (start_text !== undefined && end_text !== undefined) {
    const parsed_start = Number(start_text);
    const parsed_end = Number(end_text);
    if (
      Number.isSafeInteger(parsed_start) && Number.isSafeInteger(parsed_end)
    ) {
      start = parsed_start;
      end = parsed_end;
    }
  }
  return { source_node: origin, start, end };
}
