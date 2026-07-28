import type { BabaSourceNodeId } from "./baba_parser.ts";

export type ValueId = string & { readonly __value_id: unique symbol };

export type BindingGeneration = {
  value: ValueId;
  name: string;
  generation: number;
  origin: BabaSourceNodeId | undefined;
};

export type SemanticOrigin = {
  source_node: BabaSourceNodeId;
  start: number;
  end: number;
};

export type PhiValue = {
  value: ValueId;
  predecessors: ReadonlyMap<string, ValueId>;
  origin: SemanticOrigin | undefined;
};

export class SemanticIdentityAllocator {
  #next_value = 0;
  #generations = new Map<string, number>();
  #stable_values = new Map<string, ValueId>();
  #phi_ordinals = new Map<string, number>();
  #scope_stack = ["root"];
  readonly #namespace: string;

  constructor(namespace = "program") {
    this.#namespace = namespace;
  }

  enter_scope(scope: string): void {
    this.#scope_stack.push(scope);
  }

  leave_scope(): void {
    if (this.#scope_stack.length === 1) {
      throw new Error("Cannot leave the root semantic scope.");
    }
    this.#scope_stack.pop();
  }

  allocate_value(): ValueId {
    const value = `v${this.#next_value}`;
    this.#next_value += 1;
    return value as ValueId;
  }

  value_for(
    source_node: BabaSourceNodeId,
    role: string,
  ): ValueId {
    const key = identity_key([this.#namespace, source_node, role]);
    const existing = this.#stable_values.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const candidate = `stable:${key}` as ValueId;
    this.#stable_values.set(key, candidate);
    return candidate;
  }

  bind(
    name: string,
    origin: BabaSourceNodeId | undefined = undefined,
  ): BindingGeneration {
    const scope = identity_key(this.#scope_stack);
    const generation_key = scope + ":" + name;
    const previous_generation = this.#generations.get(generation_key);
    let generation = 0;
    if (previous_generation !== undefined) {
      generation = previous_generation + 1;
    }
    this.#generations.set(generation_key, generation);
    let value: ValueId;
    if (origin === undefined) {
      value = this.allocate_value();
    } else {
      value = this.value_for(origin, "binding:" + name + ":" + generation);
    }
    return {
      value,
      name,
      generation,
      origin,
    };
  }

  phi(
    predecessors: ReadonlyMap<string, ValueId>,
    origin: SemanticOrigin | undefined = undefined,
    role = "phi",
  ): PhiValue {
    if (predecessors.size === 0) {
      throw new Error("Cannot create a phi value without live predecessors.");
    }
    let value: ValueId;
    if (origin === undefined) {
      value = this.allocate_value();
    } else {
      const phi_key = identity_key([origin.source_node, role]);
      const previous_ordinal = this.#phi_ordinals.get(phi_key);
      let ordinal = 0;
      if (previous_ordinal !== undefined) {
        ordinal = previous_ordinal;
      }
      this.#phi_ordinals.set(phi_key, ordinal + 1);
      value = this.value_for(
        origin.source_node,
        role + ":" + ordinal.toString(),
      );
    }
    return {
      value,
      predecessors: new Map(predecessors),
      origin,
    };
  }
}

function identity_key(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

export function value_id_text(value: ValueId): string {
  return value;
}
