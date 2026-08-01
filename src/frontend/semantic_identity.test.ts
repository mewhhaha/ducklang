import { assert_equals } from "../assert.ts";
import type { BabaSourceNodeId } from "./baba_parser.ts";
import {
  SemanticIdentityAllocator,
  value_id_text,
} from "./semantic_identity.ts";

Deno.test("semantic identities distinguish rebinding generations", () => {
  const identities = new SemanticIdentityAllocator();
  const first = identities.bind("value");
  const second = identities.bind("value");

  assert_equals(first.generation, 0);
  assert_equals(second.generation, 1);
  assert_equals(
    value_id_text(first.value) === value_id_text(second.value),
    false,
  );
});

Deno.test("phi identities retain each live predecessor", () => {
  const identities = new SemanticIdentityAllocator();
  const then_value = identities.bind("value");
  const else_value = identities.bind("value");
  const phi = identities.phi(
    new Map([
      ["then", then_value.value],
      ["else", else_value.value],
    ]),
  );

  assert_equals(phi.predecessors.get("then"), then_value.value);
  assert_equals(phi.predecessors.get("else"), else_value.value);
});

Deno.test("source origins make value identities reproducible", () => {
  const source_node = "binding:0:5" as BabaSourceNodeId;
  const left = new SemanticIdentityAllocator().bind("value", source_node);
  const right = new SemanticIdentityAllocator().bind("value", source_node);

  assert_equals(left.value, right.value);
});

Deno.test("phi roles distinguish joins sharing one source origin", () => {
  const identities = new SemanticIdentityAllocator();
  const first = identities.bind("first");
  const second = identities.bind("second");
  const origin = {
    source_node: "join:0:1:0" as BabaSourceNodeId,
    start: 0,
    end: 1,
  };
  const left = identities.phi(new Map([["then", first.value]]), origin, "left");
  const right = identities.phi(
    new Map([["then", second.value]]),
    origin,
    "right",
  );

  assert_equals(left.value === right.value, false);
});

Deno.test("repeated default phis at one origin receive distinct identities", () => {
  const identities = new SemanticIdentityAllocator();
  const value = identities.bind("value");
  const origin = {
    source_node: "join:0:1:0" as BabaSourceNodeId,
    start: 0,
    end: 1,
  };
  const first = identities.phi(new Map([["then", value.value]]), origin);
  const second = identities.phi(new Map([["then", value.value]]), origin);

  assert_equals(first.value === second.value, false);
});

Deno.test("phi identities reject joins with no live predecessors", () => {
  const identities = new SemanticIdentityAllocator();

  let message = "";
  try {
    identities.phi(new Map());
  } catch (error) {
    if (error instanceof Error) {
      message = error.message;
    } else {
      message = String(error);
    }
  }

  assert_equals(
    message,
    "Cannot create a phi value without live predecessors.",
  );
});
