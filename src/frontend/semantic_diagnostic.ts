import {
  type CompilerDiagnostic,
  CompilerDiagnosticError,
  type CompilerDiagnosticRelated,
  type DiagnosticSeverity,
} from "../diagnostic.ts";
import { source_span } from "./syntax.ts";

export type SourceDiagnosticSeverity = DiagnosticSeverity;
export type SourceDiagnosticRelated = CompilerDiagnosticRelated;
export type SourceDiagnostic = CompilerDiagnostic;

export class SourceDiagnosticError extends CompilerDiagnosticError {
  constructor(diagnostic: SourceDiagnostic) {
    super(diagnostic);
    this.name = "SourceDiagnosticError";
  }
}

export function source_diagnostic(
  code: string,
  severity: SourceDiagnosticSeverity,
  message: string,
  subject: object,
  related?: SourceDiagnosticRelated[],
): SourceDiagnostic {
  const diagnostic: SourceDiagnostic = {
    code,
    severity,
    message,
    span: source_span(subject),
  };

  if (related !== undefined) {
    diagnostic.related = related;
  }

  return diagnostic;
}

export function related_source_diagnostic(
  message: string,
  subject: object,
): SourceDiagnosticRelated {
  return { message, span: source_span(subject) };
}

export function throw_source_diagnostic(
  code: string,
  message: string,
  subject: object,
  related?: SourceDiagnosticRelated[],
): never {
  throw new SourceDiagnosticError(
    source_diagnostic(code, "error", message, subject, related),
  );
}
