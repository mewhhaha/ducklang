import { Source } from "../frontend.ts";

export type LspPosition = {
  line: number;
  character: number;
};

export type LspRange = {
  start: LspPosition;
  end: LspPosition;
};

export type LspDiagnostic = {
  range: LspRange;
  severity: number;
  source: string;
  message: string;
};

// Parse the document and turn the first failure into a diagnostic. Parser
// errors carry a trailing `at line:column` (1-based); anything without a
// position lands on the first line.
export function parse_diagnostics(text: string): LspDiagnostic[] {
  try {
    Source.parse(text);
    return [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{
      range: error_range(message, text),
      severity: 1,
      source: "ix",
      message,
    }];
  }
}

function error_range(message: string, text: string): LspRange {
  const match = message.match(/ at (\d+):(\d+)$/);
  const lines = text.split("\n");

  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    const line = Number(match[1]) - 1;
    const character = Number(match[2]) - 1;
    const width = lines[line]?.length ?? character + 1;
    return {
      start: { line, character },
      end: { line, character: Math.max(width, character + 1) },
    };
  }

  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: lines[0]?.length ?? 0 },
  };
}
