import type { Core } from "./ast.ts";
import type { CoreDropPlan } from "./drop.ts";
import { scan_allocation_stmts } from "./allocation/scan.ts";
import type {
  CoreAllocationHooks,
  CoreAllocationOwnedChild,
  CoreAllocationPlan,
  CoreAllocationState,
} from "./allocation/types.ts";

export type {
  CoreAllocationByteSize,
  CoreAllocationFact,
  CoreAllocationHooks,
  CoreAllocationLayout,
  CoreAllocationOwnedChild,
  CoreAllocationPlan,
  CoreAllocationReason,
} from "./allocation/types.ts";

export function core_allocation_plan<ctx>(
  core: Core,
  ctx: ctx,
  hooks: CoreAllocationHooks<ctx>,
): CoreAllocationPlan {
  const state: CoreAllocationState = {
    next_allocation: 0,
    next_block: 0,
    next_closure: 0,
    next_scratch: 0,
    facts: [],
    recorded: new WeakMap(),
  };

  scan_allocation_stmts(
    core.statements,
    { name: "program#0", scratch: undefined },
    ctx,
    hooks,
    state,
  );

  return { facts: state.facts };
}

export function link_drop_allocations(
  drops: CoreDropPlan,
  allocations: CoreAllocationPlan,
): CoreDropPlan {
  const used = new Set<string>();
  const linked = new Set<string>();
  const steps = drops.steps.map((step, step_index) => {
    if (step.tag !== "heap_drop") {
      return step;
    }

    if (step.storage !== "persistent_unique_heap") {
      return step;
    }

    const matching = allocations.facts.filter((fact) => {
      if (used.has(fact.allocation_id)) {
        return false;
      }

      if (fact.storage !== "persistent_unique_heap") {
        return false;
      }

      if (fact.ownership.tag !== "unique_heap") {
        return false;
      }

      if (fact.ownership.reason !== step.ownership.reason) {
        return false;
      }

      return true;
    });

    let candidates = matching;

    if (step.owner) {
      candidates = matching.filter((fact) => fact.owner === step.owner);

      if (candidates.length === 0) {
        const unowned = matching.filter((fact) => !fact.owner);

        if (unowned.length === 1) {
          candidates = unowned;
        } else {
          const allocation_owners = new Set(
            matching.map((fact) => fact.owner).filter((owner) => {
              return owner !== undefined;
            }),
          );

          if (allocation_owners.size === 1) {
            candidates = matching;
          } else if (
            matching.length > 1 &&
            matching.every((fact) => linked.has(fact.allocation_id))
          ) {
            candidates = matching;
          }
        }
      }
    } else {
      const same_scope = matching.filter((fact) => fact.scope === step.scope);
      const first = same_scope[0];
      if (first) {
        candidates = [first];
      }
    }

    if (step.edge === "assignment_replace") {
      const later_drops = drops.steps.slice(step_index + 1).filter((later) => {
        return later.tag === "heap_drop" &&
          later.storage === "persistent_unique_heap" &&
          later.owner === step.owner &&
          later.ownership.reason === step.ownership.reason;
      }).length;
      const available = candidates.length - later_drops;

      if (available > 0) {
        candidates = candidates.slice(0, available);
      } else {
        candidates = [];
      }
    }

    if (candidates.length === 0) {
      return step;
    }

    const fact = candidates[0];
    if (!fact) {
      return step;
    }

    if (candidates.length > 1) {
      if (!allocations_share_cleanup_layout(candidates)) {
        return step;
      }

      if (step.edge === "assignment_replace" || !step.owner) {
        for (const candidate of candidates) {
          used.add(candidate.allocation_id);
        }
      }

      for (const candidate of candidates) {
        linked.add(candidate.allocation_id);
      }

      const owned_children = linked_allocation_owned_children(
        fact,
        allocations,
      );
      const linked_step = {
        ...step,
        allocation_ids: candidates.map((candidate) => {
          return candidate.allocation_id;
        }),
        byte_size: fact.byte_size,
        alignment: fact.alignment,
        layout: fact.layout,
      };
      if (owned_children) {
        return { ...linked_step, owned_children };
      }
      return linked_step;
    }

    if (step.edge === "assignment_replace" || !step.owner) {
      used.add(fact.allocation_id);
    }
    linked.add(fact.allocation_id);
    const owned_children = linked_allocation_owned_children(
      fact,
      allocations,
    );
    const linked_step = {
      ...step,
      allocation_id: fact.allocation_id,
      byte_size: fact.byte_size,
      alignment: fact.alignment,
      layout: fact.layout,
    };
    if (owned_children) {
      return { ...linked_step, owned_children };
    }
    return linked_step;
  });

  return { steps };
}

function linked_allocation_owned_children(
  parent: CoreAllocationPlan["facts"][number],
  allocations: CoreAllocationPlan,
): CoreAllocationPlan["facts"][number]["owned_children"] {
  if (parent.owned_children) {
    return parent.owned_children;
  }

  if (parent.reason !== "runtime_aggregate" || !parent.owner) {
    return undefined;
  }

  const templates = allocations.facts.filter((fact) => {
    return fact.reason === parent.reason && fact.layout === parent.layout &&
      fact.owned_children && fact.owned_children.length > 0;
  });
  const template = templates[0];
  if (!template || !template.owned_children) {
    return undefined;
  }

  const result: CoreAllocationOwnedChild[] = [];
  for (const template_child of template.owned_children) {
    const candidates = allocations.facts.filter((fact) => {
      return fact.scope === parent.scope && fact.owner === parent.owner &&
        fact.storage === "persistent_unique_heap" &&
        fact.layout === template_child.layout &&
        fact.ownership.tag === "unique_heap" &&
        fact.ownership.reason === template_child.ownership.reason;
    });
    let child: CoreAllocationPlan["facts"][number] | undefined = candidates[0];
    let allocation_ids: string[];
    if (candidates.length === 1 && child) {
      allocation_ids = [child.allocation_id];
    } else {
      const template_children = templates.flatMap((candidate) => {
        return (candidate.owned_children || []).filter((owned) => {
          return owned.offset === template_child.offset &&
            owned.layout === template_child.layout &&
            owned.ownership.reason === template_child.ownership.reason;
        });
      });
      if (template_children.length === 0) {
        return undefined;
      }
      allocation_ids = template_children.flatMap((owned) => {
        return owned.allocation_ids;
      });
      child = allocations.facts.find((fact) => {
        return allocation_ids.includes(fact.allocation_id);
      });
    }
    if (!child || child.ownership.tag !== "unique_heap") {
      return undefined;
    }
    result.push({
      allocation_ids,
      offset: template_child.offset,
      ownership: child.ownership,
      layout: child.layout,
    });
  }
  return result;
}

function allocations_share_cleanup_layout(
  facts: CoreAllocationPlan["facts"],
): boolean {
  const first = facts[0];

  if (!first) {
    return false;
  }

  for (const fact of facts) {
    if (fact.alignment !== first.alignment || fact.layout !== first.layout) {
      return false;
    }

    if (fact.byte_size.tag !== first.byte_size.tag) {
      return false;
    }

    if (
      fact.byte_size.tag === "static" &&
      first.byte_size.tag === "static" &&
      fact.byte_size.value !== first.byte_size.value
    ) {
      return false;
    }

    if (
      fact.byte_size.tag === "runtime" &&
      first.byte_size.tag === "runtime" &&
      fact.byte_size.formula !== first.byte_size.formula
    ) {
      return false;
    }
  }

  return true;
}
