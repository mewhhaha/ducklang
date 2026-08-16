import type { Source } from "./ast.ts";
import { validate_source_linear } from "./linear.ts";
import { source_facts, source_inference_diagnostics } from "./source_facts.ts";
import { validate_frontend_semantics } from "./semantic_validation.ts";
import { infer_front_function_signatures } from "./signature_inference.ts";
import {
  type CompilerDiagnostic,
  CompilerDiagnosticError,
} from "../diagnostic.ts";
import { derive_missing_source_spans } from "./syntax.ts";

export type BabaSemanticAnalyzeOptions = {
  warnings?: boolean;
  allow_intrinsics?: boolean;
};

export function analyze_baba_semantics(
  source: Source,
  options: BabaSemanticAnalyzeOptions = {},
): CompilerDiagnostic[] {
  derive_missing_source_spans(source, { start: 0, end: 0 });
  let diagnostics = validate_frontend_semantics(source, {
    warnings: options.warnings,
    allow_intrinsics: options.allow_intrinsics,
  });
  if (!has_error_diagnostics(diagnostics)) {
    const inference_source = infer_front_function_signatures(source);
    const facts = source_facts(inference_source);
    diagnostics = [
      ...diagnostics,
      ...source_inference_diagnostics(inference_source, facts),
    ];
  }

  try {
    validate_source_linear(source);
  } catch (error) {
    if (error instanceof CompilerDiagnosticError) {
      return [...diagnostics, error.diagnostic];
    }
    throw error;
  }
  return diagnostics;
}

function has_error_diagnostics(
  diagnostics: readonly CompilerDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
