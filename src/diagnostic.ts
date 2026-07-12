export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticSpan = {
  start: number;
  end: number;
};

export type CompilerDiagnosticRelated = {
  message: string;
  span: DiagnosticSpan;
  uri?: string;
};

export type CompilerDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  span: DiagnosticSpan;
  uri?: string;
  related?: CompilerDiagnosticRelated[];
};

export class CompilerDiagnosticError extends Error {
  constructor(readonly diagnostic: CompilerDiagnostic) {
    super(diagnostic.message);
    this.name = "CompilerDiagnosticError";
  }
}
