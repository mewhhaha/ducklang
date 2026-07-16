import type {
  CoreBaselineProofInput,
  CoreProofIssue,
  CoreValueInventoryRow,
  CoreValueInventoryTerminal,
} from "./types.ts";
import type { CoreExpr } from "../ast.ts";
import {
  core_allocation_fact_subject,
  core_allocation_facts_for_value,
} from "../allocation.ts";
import {
  core_allocation_fact_freeze_subject,
  core_allocation_fact_lifetime_subject,
  core_allocation_fact_owning_parents,
  core_allocation_fact_return_subject,
  core_allocation_fact_scratch_scope,
} from "../allocation/metadata.ts";
import { core_lifetime_scope_for_subject } from "../lifetime_scope.ts";
import { find_core_diagnostic_subject } from "../source_origin.ts";
import { canonical_core_expr } from "../subject_provenance.ts";

type CoreInventoryInput = Pick<
  CoreBaselineProofInput,
  | "allocations"
  | "cleanup"
  | "drops"
  | "final_result"
  | "freeze_edges"
  | "lifetimes"
  | "transfers"
>;

export function core_value_inventory(
  input: CoreInventoryInput,
): CoreValueInventoryRow[] {
  const final_sources = final_result_sources(input);
  let final_source_value_id: string | undefined;
  let final_source_value_ids: string[] | undefined;
  if (final_sources) {
    final_source_value_ids = final_sources.map((source) => {
      return "value:" + source.allocation_id;
    });
    if (final_source_value_ids.length === 1) {
      final_source_value_id = final_source_value_ids[0];
    }
  }
  const rows: CoreValueInventoryRow[] = [{
    tag: "final_result",
    value_id: "value:final_result",
    owner_id: inventory_owner_id(
      input.final_result.ownership.tag,
      undefined,
      undefined,
    ),
    lifetime_id: "lifetime:program#0",
    origin_id: "origin:final_result",
    escape: {
      edge: input.final_result.edge,
      escapes: input.final_result.escapes,
      decision: input.final_result.decision.tag,
    },
    terminal: final_result_terminal(input),
    source_value_id: final_source_value_id,
    source_value_ids: final_source_value_ids,
  }];

  for (const fact of input.allocations.facts) {
    const subject = core_allocation_fact_lifetime_subject(fact);
    let lifetime: ReturnType<typeof core_lifetime_scope_for_subject>;
    if (subject) {
      lifetime = core_lifetime_scope_for_subject(input.lifetimes, subject);
    }
    rows.push({
      tag: "allocation",
      value_id: "value:" + fact.allocation_id,
      owner_id: inventory_owner_id(
        fact.ownership.tag,
        fact.owner,
        fact.allocation_id,
      ),
      lifetime_id: inventory_lifetime_id(lifetime),
      origin_id: "origin:" + fact.id,
      escape: {
        edge: "allocation",
        escapes: fact.ownership.tag !== "scalar_local",
        decision: "allowed",
      },
      terminal: allocation_terminal(fact, input),
      allocation_id: fact.allocation_id,
    });
  }

  return rows;
}

export function core_validate_value_inventory(
  rows: CoreValueInventoryRow[],
  input: CoreInventoryInput,
  suppress_missing_cleanup_issues = false,
): CoreProofIssue[] {
  const issues: CoreProofIssue[] = [];
  const values = new Set<string>();
  const owners = new Set<string>();
  const allocation_ids = new Set(
    input.allocations.facts.map((fact) => fact.allocation_id),
  );
  const seen_allocations = new Set<string>();
  const final_result_rejected = input.final_result.decision.tag === "rejected";

  for (const row of rows) {
    if (values.has(row.value_id)) {
      issues.push(inventory_issue(
        "duplicate_value_inventory",
        row.value_id,
        "duplicate value inventory row",
      ));
    }
    values.add(row.value_id);

    if (owners.has(row.owner_id)) {
      issues.push(inventory_issue(
        "duplicate_value_inventory",
        row.value_id,
        "owner id names more than one inventory value",
      ));
    }
    owners.add(row.owner_id);

    if (!row.owner_id) {
      issues.push(inventory_issue(
        "missing_value_owner",
        row.value_id,
        "missing owner id",
      ));
    }
    if (!row.lifetime_id) {
      issues.push(inventory_issue(
        "missing_value_lifetime",
        row.value_id,
        "missing lifetime id",
      ));
    }
    if (!lifetime_exists(row.lifetime_id, input)) {
      issues.push(inventory_issue(
        "missing_value_lifetime",
        row.value_id,
        "lifetime id does not name a lifetime scope",
      ));
    }
    if (!row.origin_id) {
      issues.push(inventory_issue(
        "missing_value_origin",
        row.value_id,
        "missing origin id",
      ));
    }
    if (!row.escape || !row.escape.edge || !row.escape.decision) {
      issues.push(inventory_issue(
        "missing_value_escape",
        row.value_id,
        "missing escape decision",
      ));
    }
    if (!row.terminal) {
      issues.push(inventory_issue(
        "missing_value_terminal",
        row.value_id,
        "missing terminal outcome",
      ));
      continue;
    }
    if (
      row.terminal.tag === "missing_temporary_cleanup" &&
      !final_result_rejected &&
      !suppress_missing_cleanup_issues
    ) {
      issues.push(inventory_issue(
        "missing_temporary_cleanup",
        row.value_id,
        "missing terminal cleanup, transfer, promotion, or returned owner",
      ));
    }

    if (row.tag === "final_result") {
      if (row.origin_id !== "origin:final_result") {
        issues.push(inventory_issue(
          "orphan_value_inventory",
          row.value_id,
          "final result has an unknown origin",
        ));
      }
      if (row.terminal.tag === "returned_owner") {
        const allocation_ids = row.terminal.allocation_ids;
        if (!allocation_ids || allocation_ids.length === 0) {
          issues.push(inventory_issue(
            "missing_value_terminal",
            row.value_id,
            "final result lacks exact allocation provenance ids",
          ));
        } else if (!final_source_ids_match(row, allocation_ids)) {
          issues.push(inventory_issue(
            "orphan_value_inventory",
            row.value_id,
            "final result sources do not match allocation provenance ids",
          ));
        }
      }
      continue;
    }

    if (!row.allocation_id || !allocation_ids.has(row.allocation_id)) {
      issues.push(inventory_issue(
        "orphan_value_inventory",
        row.value_id,
        "allocation row does not reference an allocation fact",
      ));
      continue;
    }
    if (seen_allocations.has(row.allocation_id)) {
      issues.push(inventory_issue(
        "duplicate_value_inventory",
        row.value_id,
        "allocation has more than one inventory row",
      ));
    }
    seen_allocations.add(row.allocation_id);

    const fact = input.allocations.facts.find((candidate) => {
      return candidate.allocation_id === row.allocation_id;
    });
    if (!fact) {
      continue;
    }
    if (!inventory_terminal_matches_fact(row, fact, input)) {
      let missing_edge: Extract<
        CoreProofIssue,
        { tag: "value_inventory" }
      >["missing_edge"] = "missing_value_terminal";
      if (fact.storage === "persistent_unique_heap") {
        missing_edge = "missing_temporary_cleanup";
      }
      issues.push(inventory_issue(
        missing_edge,
        row.value_id,
        "terminal outcome does not match its storage evidence",
      ));
    }
  }

  for (const allocation_id of allocation_ids) {
    if (seen_allocations.has(allocation_id)) {
      continue;
    }
    issues.push(inventory_issue(
      "orphan_value_inventory",
      "value:" + allocation_id,
      "allocation fact has no inventory row",
    ));
  }

  return issues;
}

function inventory_terminal_matches_fact(
  row: CoreValueInventoryRow,
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
): boolean {
  const expected = allocation_terminal(fact, input);
  return inventory_terminals_equal(row.terminal, expected);
}

function allocation_terminal(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
): CoreValueInventoryTerminal {
  return resolve_allocation_terminal(fact, input, new Set());
}

function resolve_allocation_terminal(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
  visiting: Set<string>,
): CoreValueInventoryTerminal {
  const direct = direct_allocation_terminal(fact, input);
  if (direct.tag !== "missing_temporary_cleanup") {
    return direct;
  }
  if (fact.storage !== "persistent_unique_heap") {
    return direct;
  }
  if (visiting.has(fact.allocation_id)) {
    return { tag: "missing_temporary_cleanup" };
  }
  const next_visiting = new Set(visiting);
  next_visiting.add(fact.allocation_id);
  const parents = allocation_owned_parents(fact, input);
  let inherited: CoreValueInventoryTerminal | undefined;
  for (const parent of parents) {
    const terminal = resolve_allocation_terminal(
      parent,
      input,
      next_visiting,
    );
    if (!inherited) {
      inherited = terminal;
      continue;
    }
    const merged = merge_inventory_terminals(inherited, terminal);
    if (!merged) {
      return { tag: "missing_temporary_cleanup" };
    }
    inherited = merged;
  }
  if (inherited) {
    return inherited;
  }
  return direct;
}

function direct_allocation_terminal(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
): CoreValueInventoryTerminal {
  if (fact.storage === "scratch_arena") {
    const explicit_scope = core_allocation_fact_scratch_scope(fact);
    if (explicit_scope) {
      const explicit_cleanup = input.cleanup.steps.find((step) => {
        return step.scope === explicit_scope;
      });
      if (explicit_cleanup) {
        return { tag: "scratch_reset", scope: explicit_cleanup.scope };
      }
    }
    const subject = core_allocation_fact_lifetime_subject(fact);
    if (!subject) {
      return { tag: "missing_temporary_cleanup" };
    }
    const lifetime = core_lifetime_scope_for_subject(input.lifetimes, subject);
    const scratch_lifetime = enclosing_scratch_lifetime(lifetime, input);
    if (!scratch_lifetime) {
      return { tag: "missing_temporary_cleanup" };
    }
    const cleanup = input.cleanup.steps.find((step) => {
      return step.scope === scratch_lifetime.id;
    });
    if (cleanup) {
      return { tag: "scratch_reset", scope: cleanup.scope };
    }
    return { tag: "missing_temporary_cleanup" };
  }

  if (fact.storage === "static_data" || fact.storage === "frozen_heap") {
    return { tag: "no_cleanup" };
  }

  const drop = input.drops.steps.find((step) => {
    if (step.tag !== "heap_drop") {
      return false;
    }
    if (step.allocation_id === fact.allocation_id) {
      return true;
    }
    return drop_allocation_ids(step).has(fact.allocation_id);
  });
  if (drop) {
    return { tag: "drop", drop_id: drop.id };
  }

  const freeze = freeze_edge_for_allocation(fact, input);
  if (freeze) {
    return { tag: "freeze", freeze_id: freeze.id };
  }

  if (core_allocation_fact_return_subject(fact)) {
    return {
      tag: "returned_owner",
      allocation_ids: [fact.allocation_id],
    };
  }

  const final_sources = final_result_sources(input);
  if (
    final_sources && final_sources.some((source) => {
      return source.allocation_id === fact.allocation_id;
    })
  ) {
    return {
      tag: "returned_owner",
      allocation_ids: final_sources.map((source) => source.allocation_id),
    };
  }

  const transfer = transfer_edge_for_allocation(fact, input);
  const host_transfer = host_transfer_step_for_allocation(fact, input);
  if (host_transfer) {
    return { tag: "transfer", transfer_id: host_transfer.id };
  }
  if (transfer) {
    return { tag: "transfer", transfer_id: transfer.id };
  }

  return { tag: "missing_temporary_cleanup" };
}

function allocation_owned_parents(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
): CoreInventoryInput["allocations"]["facts"] {
  const parents = new Set(core_allocation_fact_owning_parents(fact));
  for (const candidate of input.allocations.facts) {
    if (!candidate.owned_children) {
      continue;
    }
    if (
      candidate.owned_children.some((child) => {
        return child.allocation_ids.includes(fact.allocation_id);
      })
    ) {
      parents.add(candidate);
    }
  }
  return Array.from(parents);
}

function inventory_terminals_equal(
  left: CoreValueInventoryTerminal,
  right: CoreValueInventoryTerminal,
): boolean {
  if (left.tag !== right.tag) {
    return false;
  }
  switch (left.tag) {
    case "drop":
      return right.tag === "drop" && left.drop_id === right.drop_id;
    case "transfer":
      return right.tag === "transfer" &&
        left.transfer_id === right.transfer_id;
    case "freeze":
      return right.tag === "freeze" && left.freeze_id === right.freeze_id;
    case "returned_owner": {
      if (right.tag !== "returned_owner") {
        return false;
      }
      if (!left.allocation_ids || !right.allocation_ids) {
        return left.allocation_ids === right.allocation_ids;
      }
      return same_string_set(left.allocation_ids, right.allocation_ids);
    }
    case "scratch_reset":
      return right.tag === "scratch_reset" && left.scope === right.scope;
    case "no_cleanup":
      return right.tag === "no_cleanup";
    case "missing_temporary_cleanup":
      return right.tag === "missing_temporary_cleanup";
  }
}

function merge_inventory_terminals(
  left: CoreValueInventoryTerminal,
  right: CoreValueInventoryTerminal,
): CoreValueInventoryTerminal | undefined {
  if (inventory_terminals_equal(left, right)) {
    return left;
  }
  if (left.tag !== "returned_owner" || right.tag !== "returned_owner") {
    return undefined;
  }
  if (!left.allocation_ids || !right.allocation_ids) {
    return undefined;
  }
  const allocation_ids: string[] = [];
  const seen = new Set<string>();
  for (
    const allocation_id of left.allocation_ids.concat(right.allocation_ids)
  ) {
    if (seen.has(allocation_id)) {
      continue;
    }
    seen.add(allocation_id);
    allocation_ids.push(allocation_id);
  }
  return { tag: "returned_owner", allocation_ids };
}

function host_transfer_step_for_allocation(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
):
  | Extract<CoreInventoryInput["drops"]["steps"][number], {
    tag: "host_transfer";
  }>
  | undefined {
  for (const step of input.drops.steps) {
    if (step.tag !== "host_transfer") {
      continue;
    }
    if (
      step.scope !== fact.scope &&
      !step.scope.startsWith(fact.scope + "/static_call/")
    ) {
      continue;
    }
    const subject = find_core_diagnostic_subject(step);
    if (!subject || !inventory_subject_is_expr(subject)) {
      continue;
    }
    const sources = core_allocation_facts_for_value(
      input.allocations,
      subject,
    );
    if (
      sources && sources.some((source) => {
        return source.allocation_id === fact.allocation_id;
      })
    ) {
      return step;
    }

    const fact_subject = core_allocation_fact_subject(input.allocations, fact);
    if (
      fact_subject &&
      canonical_core_expr(fact_subject) === canonical_core_expr(subject)
    ) {
      return step;
    }
  }
  return undefined;
}

function freeze_edge_for_allocation(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
): CoreInventoryInput["freeze_edges"][number] | undefined {
  let freeze_subject = core_allocation_fact_freeze_subject(fact);
  if (!freeze_subject) {
    freeze_subject = core_allocation_fact_subject(input.allocations, fact);
  }
  if (!freeze_subject || freeze_subject.tag !== "freeze") {
    return undefined;
  }

  return input.freeze_edges.find((edge) => {
    const edge_subject = find_core_diagnostic_subject(edge);
    if (!edge_subject || edge_subject.tag !== "freeze") {
      return false;
    }
    return canonical_core_expr(edge_subject) ===
      canonical_core_expr(freeze_subject);
  });
}

function transfer_edge_for_allocation(
  fact: CoreInventoryInput["allocations"]["facts"][number],
  input: CoreInventoryInput,
): CoreInventoryInput["transfers"]["transfers"][number] | undefined {
  for (const edge of input.transfers.transfers) {
    const subject = find_core_diagnostic_subject(edge);
    if (!subject || !inventory_subject_is_expr(subject)) {
      continue;
    }
    const sources = core_allocation_facts_for_value(
      input.allocations,
      subject,
    );
    if (
      sources && sources.some((source) => {
        return source.allocation_id === fact.allocation_id;
      })
    ) {
      return edge;
    }

    const fact_subject = core_allocation_fact_subject(input.allocations, fact);
    if (!fact_subject) {
      continue;
    }
    if (
      canonical_core_expr(fact_subject) === canonical_core_expr(subject)
    ) {
      return edge;
    }
  }
  return undefined;
}

function final_result_terminal(
  input: CoreInventoryInput,
): CoreValueInventoryTerminal {
  if (input.final_result.ownership.tag === "unique_heap") {
    const sources = final_result_sources(input);
    if (!sources) {
      return { tag: "missing_temporary_cleanup" };
    }
    return {
      tag: "returned_owner",
      allocation_ids: sources.map((source) => source.allocation_id),
    };
  }
  if (input.final_result.ownership.tag === "scratch_backed") {
    return { tag: "missing_temporary_cleanup" };
  }
  return { tag: "no_cleanup" };
}

function inventory_owner_id(
  ownership: string,
  owner: string | undefined,
  allocation_id: string | undefined,
): string {
  if (owner) {
    if (allocation_id) {
      return "owner:" + owner + ":" + allocation_id;
    }
    return "owner:" + owner;
  }
  if (allocation_id) {
    return "owner:" + allocation_id;
  }
  return "owner:" + ownership;
}

function lifetime_exists(
  lifetime_id: string,
  input: CoreInventoryInput,
): boolean {
  const prefix = "lifetime:";
  if (!lifetime_id.startsWith(prefix)) {
    return false;
  }
  const scope_id = lifetime_id.slice(prefix.length);
  return input.lifetimes.scopes.some((scope) => scope.id === scope_id);
}

function final_result_sources(
  input: CoreInventoryInput,
): CoreInventoryInput["allocations"]["facts"] | undefined {
  if (input.final_result.ownership.tag !== "unique_heap") {
    return undefined;
  }
  const subject = find_core_diagnostic_subject(input.final_result);
  if (!subject || !inventory_subject_is_expr(subject)) {
    return undefined;
  }
  const explicit = core_allocation_facts_for_value(
    input.allocations,
    subject,
  );
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const matching = input.allocations.facts.filter((fact) => {
    return core_allocation_fact_subject(input.allocations, fact) === subject;
  });
  if (matching.length !== 1) {
    return undefined;
  }
  return matching;
}

function inventory_subject_is_expr(
  subject: import("../source_origin.ts").CoreSourceSubject,
): subject is CoreExpr {
  switch (subject.tag) {
    case "bind":
    case "assign":
    case "index_assign":
    case "range_loop":
    case "collection_loop":
    case "if_stmt":
    case "if_else_stmt":
    case "if_let_stmt":
    case "type_check":
    case "break":
    case "continue":
    case "return":
    case "expr":
      return false;
    default:
      return true;
  }
}

function final_source_ids_match(
  row: CoreValueInventoryRow,
  allocation_ids: string[],
): boolean {
  const expected = allocation_ids.map((allocation_id) => {
    return "value:" + allocation_id;
  });
  if (row.source_value_ids) {
    return same_string_set(row.source_value_ids, expected);
  }
  if (expected.length !== 1) {
    return false;
  }
  return row.source_value_id === expected[0];
}

function same_string_set(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const right_values = new Set(right);
  if (right_values.size !== right.length) {
    return false;
  }
  for (const value of left) {
    if (!right_values.has(value)) {
      return false;
    }
  }
  return true;
}

function drop_allocation_ids(
  step: Extract<CoreInventoryInput["drops"]["steps"][number], {
    tag: "heap_drop";
  }>,
): Set<string> {
  const allocation_ids = new Set<string>();

  if (step.allocation_id) {
    allocation_ids.add(step.allocation_id);
  }
  if (step.allocation_ids) {
    for (const allocation_id of step.allocation_ids) {
      allocation_ids.add(allocation_id);
    }
  }
  if (step.owned_children) {
    collect_drop_owned_child_allocation_ids(
      allocation_ids,
      step.owned_children,
    );
  }

  return allocation_ids;
}

function collect_drop_owned_child_allocation_ids(
  allocation_ids: Set<string>,
  children: import("../allocation.ts").CoreAllocationOwnedChild[],
): void {
  for (const child of children) {
    for (const allocation_id of child.allocation_ids) {
      allocation_ids.add(allocation_id);
    }
    if (child.owned_children) {
      collect_drop_owned_child_allocation_ids(
        allocation_ids,
        child.owned_children,
      );
    }
  }
}

function inventory_lifetime_id(
  lifetime: { id: string } | undefined,
): string {
  if (lifetime) {
    return "lifetime:" + lifetime.id;
  }
  return "lifetime:missing";
}

function enclosing_scratch_lifetime(
  lifetime: ReturnType<typeof core_lifetime_scope_for_subject>,
  input: CoreInventoryInput,
):
  | Extract<CoreInventoryInput["lifetimes"]["scopes"][number], {
    kind: "scratch";
  }>
  | undefined {
  let current = lifetime;
  while (current) {
    if (current.kind === "scratch") {
      return current;
    }
    if (!current.parent) {
      return undefined;
    }
    const parent = current.parent;
    current = input.lifetimes.scopes.find((scope) => {
      return scope.id === parent;
    });
  }
  return undefined;
}

function inventory_issue(
  missing_edge: Extract<
    CoreProofIssue,
    { tag: "value_inventory" }
  >["missing_edge"],
  value_id: string,
  detail: string,
): CoreProofIssue {
  return {
    tag: "value_inventory",
    missing_edge,
    value_id,
    message: "Rejected baseline proof " + value_id + ": " + detail,
  };
}
