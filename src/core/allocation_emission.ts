import type {
  CoreAllocationFact,
  CoreAllocationLayout,
  CoreAllocationPlan,
  CoreAllocationReason,
} from "./allocation.ts";
import type { CoreStorageClass } from "./escape.ts";
import type { CoreExpr } from "./ast.ts";
import {
  core_allocation_fact_emission_subjects,
  core_allocation_fact_permit_metadata,
  core_allocation_fact_subject,
} from "./allocation/metadata.ts";
import { canonical_core_expr } from "./subject_provenance.ts";

export type CoreAllocationPermitRequest = {
  subject: CoreExpr;
  reason: CoreAllocationReason;
  storage: Extract<
    CoreStorageClass,
    "persistent_unique_heap" | "scratch_arena"
  >;
  layout: CoreAllocationLayout;
  emission_site: string;
};

export type CoreAllocationPermitState = {
  permits: CoreAllocationFact[];
  consumed: CoreAllocationFact[];
};

export function create_core_allocation_permit_state(
  plan: CoreAllocationPlan,
): CoreAllocationPermitState {
  return {
    permits: plan.facts.filter((fact) => {
      const metadata = core_allocation_fact_permit_metadata(fact);
      if (!metadata) {
        throw new Error(
          "Core allocation emission requires permit metadata: " + fact.id,
        );
      }
      return metadata.producer !== "external";
    }),
    consumed: [],
  };
}

export function consume_core_allocation_permit(
  state: CoreAllocationPermitState,
  request: CoreAllocationPermitRequest,
): void {
  const index = state.permits.findIndex((fact) => {
    const metadata = core_allocation_fact_permit_metadata(fact);
    const fact_subjects = core_allocation_fact_emission_subjects(fact);
    if (!fact_subjects) {
      return false;
    }
    const request_subject = canonical_core_expr(request.subject);
    const subject_matches = Array.from(fact_subjects).some((subject) => {
      return canonical_core_expr(subject) === request_subject;
    });
    return subject_matches &&
      fact.reason === request.reason &&
      fact.storage === request.storage &&
      fact.layout === request.layout &&
      metadata?.emission_site === request.emission_site;
  });

  if (index < 0) {
    const remaining = state.permits.map((fact) => {
      const subject = core_allocation_fact_subject(fact);
      let detail = "missing-subject";
      if (subject) {
        detail = describe_allocation_subject(subject);
      }
      return fact.allocation_id + "=" + detail;
    }).join(", ");
    const consumed = state.consumed.map((fact) => {
      return fact.allocation_id;
    }).join(", ");
    throw new Error(
      "Core allocation emission has no permit for " + request.reason +
        " " + request.storage + " " + request.layout + " at " +
        request.emission_site + " (" + request.subject.tag + "); remaining: " +
        remaining + "; request: " +
        describe_allocation_subject(request.subject) + "; consumed: " +
        consumed,
    );
  }

  const consumed = state.permits.splice(index, 1);
  const fact = consumed[0];
  if (!fact) {
    throw new Error("Core allocation permit consumption lost its fact");
  }
  state.consumed.push(fact);
}

function describe_allocation_subject(subject: CoreExpr): string {
  const canonical = canonical_core_expr(subject);
  let detail = subject.tag + "->" + canonical.tag;
  if (subject.tag === "var" || subject.tag === "linear") {
    detail += "(" + subject.name + ")";
  }
  if (canonical.tag === "var" || canonical.tag === "linear") {
    detail += "(" + canonical.name + ")";
  }
  return detail;
}

export function check_core_allocation_permits(
  state: CoreAllocationPermitState,
): void {
  const required = state.permits.filter((fact) => {
    const metadata = core_allocation_fact_permit_metadata(fact);
    return metadata?.required;
  });
  if (required.length === 0) {
    return;
  }

  const remaining = required.map((fact) => fact.allocation_id).join(", ");
  throw new Error("Core allocation emission left unused permits: " + remaining);
}
