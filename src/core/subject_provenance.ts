import type { CoreExpr, CoreStmt } from "./ast.ts";

export type CoreSubject = CoreExpr | CoreStmt;

const core_subject_sources = new WeakMap<CoreSubject, CoreSubject>();

export function record_core_expr_provenance<expr extends CoreExpr>(
  derived: expr,
  source: CoreExpr,
): expr {
  if (
    derived.ascribed_type === undefined &&
    source.ascribed_type !== undefined
  ) {
    derived.ascribed_type = source.ascribed_type;
  }

  core_subject_sources.set(derived, source);
  return derived;
}

export function canonical_core_expr(expr: CoreExpr): CoreExpr {
  return canonical_core_subject(expr) as CoreExpr;
}

export function canonical_core_subject(subject: CoreSubject): CoreSubject {
  let canonical: CoreSubject = subject;
  const visited = new Set<CoreSubject>();

  while (!visited.has(canonical)) {
    visited.add(canonical);
    const source = core_subject_sources.get(canonical);

    if (!source) {
      return canonical;
    }

    canonical = source;
  }

  return canonical;
}
