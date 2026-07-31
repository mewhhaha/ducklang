import { expect } from "../expect.ts";
import type { BabaSourceNodeId } from "./baba_parser.ts";
import {
  SemanticIdentityAllocator,
  type SemanticOrigin,
  type ValueId,
} from "./semantic_identity.ts";
import {
  type RepresentationType,
  same_representation_type,
  snapshot_representation_type,
} from "./representation_type.ts";
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
  | { tag: "type_test"; type: string }
  | {
    tag: "index";
    length: number | undefined;
    mode: "read" | "move" | "write";
  }
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

export function semantic_cfg_is_well_formed(
  control_flow: SemanticCfg,
): boolean {
  if (
    typeof control_flow.entry !== "number" ||
    !Number.isSafeInteger(control_flow.entry) ||
    control_flow.entry < 0
  ) {
    return false;
  }
  const blocks = new Map<SemanticBlockId, SemanticBlock>();
  for (const block of control_flow.blocks) {
    if (
      typeof block.id !== "number" ||
      !Number.isSafeInteger(block.id) ||
      block.id < 0 ||
      blocks.has(block.id)
    ) {
      return false;
    }
    blocks.set(block.id, block);
  }
  if (!blocks.has(control_flow.entry)) return false;

  const values = new Map<ValueId, SemanticValue>();
  for (const value of control_flow.values) {
    if (values.has(value.value)) return false;
    values.set(value.value, value);
  }
  const parameters = new Set<ValueId>();
  for (const parameter of control_flow.parameters) {
    if (!values.has(parameter) || parameters.has(parameter)) return false;
    parameters.add(parameter);
  }

  type ProducerLocation = {
    block: SemanticBlockId;
    index: number;
    node: SemanticNode;
  };
  const producers = new Map<ValueId, ProducerLocation>();
  const node_ids = new Set<SemanticNodeId>();
  for (const block of control_flow.blocks) {
    for (let index = 0; index < block.nodes.length; index += 1) {
      const node = block.nodes[index];
      if (node === undefined) return false;
      if (
        typeof node.id !== "number" ||
        !Number.isSafeInteger(node.id) ||
        node.id < 0 ||
        node_ids.has(node.id)
      ) {
        return false;
      }
      node_ids.add(node.id);
      for (const input of node.inputs) {
        if (!values.has(input)) return false;
      }
      for (const output of node.outputs) {
        if (
          !values.has(output) ||
          parameters.has(output) ||
          producers.has(output)
        ) {
          return false;
        }
        producers.set(output, { block: block.id, index, node });
      }
    }
  }
  if (values.size !== parameters.size + producers.size) return false;

  const expected_predecessors = new Map<
    SemanticBlockId,
    Set<SemanticBlockId>
  >();
  for (const block of control_flow.blocks) {
    expected_predecessors.set(block.id, new Set());
  }
  for (const block of control_flow.blocks) {
    const expected_successors: SemanticBlockId[] = [];
    switch (block.terminator.tag) {
      case "jump":
        expected_successors.push(block.terminator.target);
        break;
      case "branch": {
        if (
          block.terminator.when_true === block.terminator.when_false
        ) {
          return false;
        }
        const condition = values.get(block.terminator.condition);
        if (
          condition === undefined ||
          !same_representation_type(condition.type, {
            tag: "scalar",
            name: "Bool",
          })
        ) {
          return false;
        }
        expected_successors.push(
          block.terminator.when_true,
          block.terminator.when_false,
        );
        break;
      }
      case "return":
        if (
          block.terminator.value !== undefined &&
          !values.has(block.terminator.value)
        ) {
          return false;
        }
        break;
      case "trap":
        break;
      default:
        return false;
    }
    const declared_successors = new Set(block.successors);
    if (
      declared_successors.size !== block.successors.length ||
      declared_successors.size !== expected_successors.length
    ) {
      return false;
    }
    for (const successor of expected_successors) {
      if (
        !blocks.has(successor) ||
        !declared_successors.has(successor)
      ) {
        return false;
      }
      const predecessors = expected_predecessors.get(successor);
      if (predecessors === undefined) return false;
      predecessors.add(block.id);
    }
  }
  for (const block of control_flow.blocks) {
    const declared_predecessors = new Set(block.predecessors);
    const expected = expected_predecessors.get(block.id);
    if (
      expected === undefined ||
      declared_predecessors.size !== block.predecessors.length ||
      declared_predecessors.size !== expected.size
    ) {
      return false;
    }
    for (const predecessor of expected) {
      if (!declared_predecessors.has(predecessor)) return false;
    }
  }

  const block_ids = new Set(blocks.keys());
  const dominators = new Map<SemanticBlockId, Set<SemanticBlockId>>();
  for (const block of control_flow.blocks) {
    if (block.id === control_flow.entry) {
      dominators.set(block.id, new Set([block.id]));
    } else {
      dominators.set(block.id, new Set(block_ids));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of control_flow.blocks) {
      if (block.id === control_flow.entry) continue;
      let intersection = new Set(block_ids);
      if (block.predecessors.length === 0) intersection = new Set();
      for (const predecessor of block.predecessors) {
        const predecessor_dominators = dominators.get(predecessor);
        if (predecessor_dominators === undefined) return false;
        intersection = new Set(
          [...intersection].filter((candidate) =>
            predecessor_dominators.has(candidate)
          ),
        );
      }
      intersection.add(block.id);
      const previous = dominators.get(block.id);
      if (previous === undefined) return false;
      if (same_values(previous, intersection)) continue;
      dominators.set(block.id, intersection);
      changed = true;
    }
  }

  const value_is_available = (
    value: ValueId,
    block: SemanticBlock,
    index: number,
  ): boolean => {
    const block_dominators = dominators.get(block.id);
    if (block_dominators === undefined) return false;
    if (parameters.has(value)) {
      return block_dominators.has(control_flow.entry);
    }
    const producer = producers.get(value);
    if (producer === undefined) return false;
    if (producer.block === block.id) return producer.index < index;
    return block_dominators.has(producer.block);
  };

  for (const block of control_flow.blocks) {
    for (let index = 0; index < block.nodes.length; index += 1) {
      const node = block.nodes[index];
      if (node === undefined) return false;
      if (node.operation.tag === "type_test") {
        if (
          typeof node.operation.type !== "string" ||
          node.operation.type.length === 0 ||
          node.inputs.length !== 1 ||
          node.outputs.length !== 1
        ) {
          return false;
        }
        const output_value = node.outputs[0];
        if (output_value === undefined) return false;
        const output = values.get(output_value);
        if (
          output === undefined ||
          !same_representation_type(output.type, {
            tag: "scalar",
            name: "Bool",
          })
        ) {
          return false;
        }
      }
      if (node.operation.tag === "index") {
        let expected_inputs = 2;
        if (node.operation.mode === "write") expected_inputs = 3;
        if (
          (node.operation.mode !== "read" &&
            node.operation.mode !== "move" &&
            node.operation.mode !== "write") ||
          node.inputs.length !== expected_inputs ||
          node.outputs.length !== 1 ||
          (node.operation.length !== undefined &&
            (!Number.isSafeInteger(node.operation.length) ||
              node.operation.length < 0))
        ) {
          return false;
        }
        const object_value = node.inputs[0];
        if (object_value === undefined) return false;
        const stored_object_type = values.get(object_value)?.type;
        if (stored_object_type === undefined) return false;
        let object_type = stored_object_type;
        while (object_type.tag === "owned") object_type = object_type.value;
        const index_value = node.inputs[1];
        if (index_value === undefined) return false;
        let index_type = values.get(index_value)?.type;
        if (index_type === undefined) return false;
        while (index_type.tag === "owned") index_type = index_type.value;
        const index_is_i32_family = index_type.tag === "scalar" &&
            (index_type.name === "Int" || index_type.name === "I32" ||
              index_type.name === "U32") ||
          index_type.tag === "integer" && index_type.width <= 32;
        if (!index_is_i32_family) return false;
        let static_length: number | undefined;
        let element_type: RepresentationType | undefined;
        if (
          object_type.tag === "product" || object_type.tag === "record"
        ) {
          static_length = object_type.fields.length;
          const index_producer = producers.get(index_value)?.node;
          if (
            index_producer?.operation.tag === "constant" &&
            (typeof index_producer.operation.value === "number" ||
              typeof index_producer.operation.value === "bigint")
          ) {
            const constant = index_producer.operation.value;
            let field_index: number | undefined;
            if (
              typeof constant === "number" &&
              Number.isSafeInteger(constant)
            ) {
              field_index = constant;
            } else if (
              typeof constant === "bigint" &&
              constant >= BigInt(Number.MIN_SAFE_INTEGER) &&
              constant <= BigInt(Number.MAX_SAFE_INTEGER)
            ) {
              field_index = Number(constant);
            }
            if (field_index !== undefined) {
              element_type = object_type.fields[field_index]?.type;
            }
            if (element_type === undefined) {
              const first = object_type.fields[0]?.type;
              if (
                first !== undefined &&
                object_type.fields.every((field) =>
                  same_representation_type(field.type, first)
                )
              ) {
                element_type = first;
              }
            }
          } else {
            const first = object_type.fields[0]?.type;
            if (
              first !== undefined &&
              object_type.fields.every((field) =>
                same_representation_type(field.type, first)
              )
            ) {
              element_type = first;
            }
          }
        } else if (object_type.tag === "fixed_array") {
          static_length = object_type.length;
          element_type = object_type.element;
        } else if (
          object_type.tag === "scalar" &&
          (object_type.name === "Text" || object_type.name === "Bytes")
        ) {
          element_type = { tag: "scalar", name: "I32" };
        }
        if (node.operation.length !== static_length) return false;
        if (element_type === undefined) return false;
        const output_value = node.outputs[0];
        if (output_value === undefined) return false;
        const output_type = values.get(output_value)?.type;
        if (output_type === undefined) return false;
        if (node.operation.mode === "write") {
          const replacement_value = node.inputs[2];
          if (replacement_value === undefined) return false;
          const replacement_type = values.get(replacement_value)?.type;
          if (
            replacement_type === undefined ||
            !same_representation_type(replacement_type, element_type) ||
            !same_representation_type(output_type, stored_object_type)
          ) {
            return false;
          }
        } else if (!same_representation_type(output_type, element_type)) {
          return false;
        }
      }
      if (
        node.operation.tag === "call" &&
        node.operation.function_name === "@len"
      ) {
        if (node.inputs.length !== 1 || node.outputs.length !== 1) return false;
        const object_value = node.inputs[0];
        const output_value = node.outputs[0];
        if (object_value === undefined || output_value === undefined) {
          return false;
        }
        let object_type = values.get(object_value)?.type;
        let output_type = values.get(output_value)?.type;
        if (object_type === undefined || output_type === undefined) {
          return false;
        }
        while (object_type.tag === "owned") object_type = object_type.value;
        while (output_type.tag === "owned") output_type = output_type.value;
        const measurable = object_type.tag === "product" ||
          object_type.tag === "record" ||
          object_type.tag === "fixed_array" ||
          object_type.tag === "scalar" &&
            (object_type.name === "Text" || object_type.name === "Bytes");
        const returns_i32 = output_type.tag === "scalar" &&
            (output_type.name === "Int" || output_type.name === "I32") ||
          output_type.tag === "integer" &&
            output_type.signed && output_type.width === 32;
        if (!measurable || !returns_i32) return false;
      }
      if (node.operation.tag === "phi") {
        if (
          node.outputs.length !== 1 ||
          node.inputs.length !== node.operation.incoming.length ||
          node.operation.incoming.length !== block.predecessors.length
        ) {
          return false;
        }
        const output_value = node.outputs[0];
        if (output_value === undefined) return false;
        const incoming_predecessors = new Set<SemanticBlockId>();
        for (
          let incoming_index = 0;
          incoming_index < node.operation.incoming.length;
          incoming_index += 1
        ) {
          const incoming = node.operation.incoming[incoming_index];
          if (
            incoming === undefined ||
            node.inputs[incoming_index] !== incoming.value ||
            !block.predecessors.includes(incoming.predecessor) ||
            incoming_predecessors.has(incoming.predecessor)
          ) {
            return false;
          }
          incoming_predecessors.add(incoming.predecessor);
          const predecessor = blocks.get(incoming.predecessor);
          if (
            predecessor === undefined ||
            !value_is_available(
              incoming.value,
              predecessor,
              predecessor.nodes.length,
            )
          ) {
            return false;
          }
          const input = values.get(incoming.value);
          const output = values.get(output_value);
          if (
            input === undefined ||
            output === undefined ||
            !same_representation_type(input.type, output.type)
          ) {
            return false;
          }
        }
        continue;
      }
      for (const input of node.inputs) {
        if (!value_is_available(input, block, index)) return false;
      }
    }
    if (block.terminator.tag === "branch") {
      if (
        !value_is_available(
          block.terminator.condition,
          block,
          block.nodes.length,
        )
      ) {
        return false;
      }
    }
    if (
      block.terminator.tag === "return" &&
      block.terminator.value !== undefined &&
      !value_is_available(
        block.terminator.value,
        block,
        block.nodes.length,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function unique_semantic_call_at_span(
  control_flow: SemanticCfg,
  span: SourceSpan,
): { block: SemanticBlock; node: SemanticNode } | undefined {
  const calls = semantic_calls_at_span(control_flow, span);
  if (calls.length !== 1) return undefined;
  return calls[0];
}

export function semantic_calls_at_span(
  control_flow: SemanticCfg,
  span: SourceSpan,
): readonly { block: SemanticBlock; node: SemanticNode }[] {
  const calls: { block: SemanticBlock; node: SemanticNode }[] = [];
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      if (
        node.operation.tag !== "call" ||
        node.span.start !== span.start ||
        node.span.end !== span.end
      ) {
        continue;
      }
      calls.push({ block, node });
    }
  }
  return calls;
}

export function unique_semantic_index_at_span(
  control_flow: SemanticCfg,
  span: SourceSpan,
): { block: SemanticBlock; node: SemanticNode } | undefined {
  const indexes = semantic_indexes_at_span(control_flow, span);
  if (indexes.length !== 1) return undefined;
  return indexes[0];
}

export function semantic_indexes_at_span(
  control_flow: SemanticCfg,
  span: SourceSpan,
): readonly { block: SemanticBlock; node: SemanticNode }[] {
  const indexes: { block: SemanticBlock; node: SemanticNode }[] = [];
  for (const block of control_flow.blocks) {
    for (const node of block.nodes) {
      if (
        node.operation.tag !== "index" ||
        node.span.start !== span.start ||
        node.span.end !== span.end
      ) {
        continue;
      }
      indexes.push({ block, node });
    }
  }
  return indexes;
}

export type SemanticCallableControlFlow = {
  callable: ValueId;
  parameters: readonly ValueId[];
  captures: readonly ValueId[];
  recursive_self: ValueId | undefined;
  recursive_group: readonly ValueId[];
  control_flow: SemanticCfg;
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
  readonly #phi_blocks = new Map<ValueId, SemanticBlockId>();

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
    const stable_types = output_types.map(snapshot_representation_type);
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
    const stable_type = snapshot_representation_type(type);
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
          same_representation_type(incoming_value.type, stable_type),
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
    this.#phi_blocks.set(output, block_id);
    return output;
  }

  add_phi_input(
    phi: ValueId,
    predecessor: SemanticBlockId,
    value: ValueId,
  ): void {
    const block_id = this.#phi_blocks.get(phi);
    expect(block_id !== undefined, `CFG ValueId ${String(phi)} is not a phi.`);
    const block = this.block(block_id);
    expect(
      block.predecessors.has(predecessor),
      `CFG phi predecessor ${String(predecessor)} is not connected to block ${
        String(block_id)
      }.`,
    );
    const phi_value = this.#values.get(phi);
    const incoming_value = this.#values.get(value);
    expect(
      phi_value !== undefined && incoming_value !== undefined,
      "CFG phi input has no semantic value.",
    );
    expect(
      same_representation_type(phi_value.type, incoming_value.type),
      `CFG phi ValueId ${String(value)} has an incompatible type.`,
    );
    const node_index = block.nodes.findIndex((node) =>
      node.outputs.length === 1 && node.outputs[0] === phi
    );
    expect(node_index >= 0, `CFG phi ValueId ${String(phi)} has no node.`);
    const node = block.nodes[node_index];
    expect(node !== undefined, "CFG phi node disappeared.");
    expect(node.operation.tag === "phi", "CFG phi node changed operation.");
    expect(
      !node.operation.incoming.some((entry) =>
        entry.predecessor === predecessor
      ),
      `CFG phi already has predecessor ${String(predecessor)}.`,
    );
    const incoming = [
      ...node.operation.incoming,
      Object.freeze({ predecessor, value }),
    ];
    expect(
      incoming.length <= block.predecessors.size,
      "CFG phi has more inputs than predecessors.",
    );
    block.nodes[node_index] = Object.freeze({
      id: node.id,
      origin: node.origin,
      span: node.span,
      inputs: Object.freeze(incoming.map((entry) => entry.value)),
      outputs: node.outputs,
      operation: Object.freeze({
        tag: "phi",
        incoming: Object.freeze(incoming),
      }),
    });
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
          same_representation_type(condition.type, {
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
    const reachable = new Set<SemanticBlockId>([entry]);
    const pending = [entry];
    while (pending.length > 0) {
      const current = pending.pop();
      expect(current !== undefined, "CFG reachability work disappeared.");
      for (const successor of this.block(current).successors) {
        if (reachable.has(successor)) continue;
        reachable.add(successor);
        pending.push(successor);
      }
    }
    const available_at_entry = new Map<SemanticBlockId, Set<ValueId>>();
    const available_after_block = new Map<SemanticBlockId, Set<ValueId>>();
    for (const block of this.#blocks) {
      let initial = new Set<ValueId>();
      if (block.id !== entry && reachable.has(block.id)) {
        initial = new Set(this.#defined_values);
      }
      available_at_entry.set(block.id, new Set(initial));
      available_after_block.set(block.id, initial);
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

function same_values<value>(
  left: ReadonlySet<value>,
  right: ReadonlySet<value>,
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
  const stable_type = snapshot_representation_type(type);
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
    case "type_test":
      return Object.freeze({
        tag: "type_test",
        type: required_text(operation.type),
      });
    case "index":
      expect(
        operation.length === undefined ||
          Number.isSafeInteger(operation.length) && operation.length >= 0,
        "CFG index length must be a non-negative safe integer.",
      );
      expect(
        operation.mode === "read" || operation.mode === "move" ||
          operation.mode === "write",
        "CFG index mode is invalid.",
      );
      return Object.freeze({
        tag: "index",
        length: operation.length,
        mode: operation.mode,
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
