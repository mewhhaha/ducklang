import {
  type BindingEntity,
  type BindingIndex,
  build_binding_index,
} from "../frontend/binding_index.ts";
import type { Source as FrontSource } from "../frontend/ast.ts";
import { Source } from "../frontend/source.ts";
import { scan_source, source_tokens } from "../frontend/tokenize.ts";
import { document_content_hash, type TextDocument } from "./documents.ts";
import {
  definition_location,
  fuzzy_score,
  type LspLocation,
  type LspWorkspaceEdit,
  type LspWorkspaceSymbol,
  reference_locations,
  rename_symbol,
  type WorkspaceIndexEntry,
} from "./navigation.ts";
import { type PositionEncoding, PositionIndex } from "./position.ts";
import { symbol_kind } from "./symbols.ts";

export type WorkspaceLoadProgress = {
  uri: string;
  loaded: number;
  total: number;
};

export type WorkspaceAnalysisEntry = WorkspaceIndexEntry & {
  source: FrontSource;
  content_hash: string;
};

type CachedWorkspaceFile = {
  analysis: WorkspaceAnalysisEntry | undefined;
  content_hash: string;
  dependencies: Set<string>;
  names: Set<string>;
  symbol_sites: WorkspaceSymbolSite[];
  text: string;
  uri: string;
};

type WorkspaceSymbolSite = {
  container_name: string | undefined;
  end: number;
  kind: number;
  name: string;
  start: number;
};

type WorkspaceTarget = {
  entry: WorkspaceAnalysisEntry;
  entity: BindingEntity;
};

export class WorkspaceModel {
  readonly roots: string[];
  #files = new Map<string, CachedWorkspaceFile>();
  #dependencies = new Map<string, Set<string>>();
  #reverse_dependencies = new Map<string, Set<string>>();

  constructor(roots: string[]) {
    this.roots = discover_workspace_roots(roots);
  }

  load(
    overlays: readonly TextDocument[],
    progress?: (event: WorkspaceLoadProgress) => void,
  ): void {
    const uris = workspace_duck_files(this.roots);
    const overlay_by_uri = new Map(
      overlays.map((document) => [document.uri, document]),
    );
    const next = new Map<string, CachedWorkspaceFile>();

    for (let index = 0; index < uris.length; index += 1) {
      const uri = uris[index];

      if (uri === undefined) {
        throw new Error("Missing workspace file URI");
      }

      let text: string | undefined;
      const overlay = overlay_by_uri.get(uri);

      if (overlay !== undefined) {
        text = overlay.text;
      } else {
        text = read_workspace_file(uri);
      }

      if (text !== undefined) {
        const existing = this.#files.get(uri);
        const hash = document_content_hash(text);

        if (
          existing !== undefined && existing.content_hash === hash &&
          existing.text === text
        ) {
          next.set(uri, existing);
        } else {
          next.set(uri, workspace_file(uri, text));
        }
      }

      if (progress !== undefined) {
        progress({ uri, loaded: index + 1, total: uris.length });
      }
    }

    for (const overlay of overlays) {
      if (!next.has(overlay.uri)) {
        next.set(
          overlay.uri,
          workspace_file(overlay.uri, overlay.text),
        );
      }
    }

    this.#files = next;
    this.rebuild_graph();
  }

  refresh(uri: string, overlay: TextDocument | undefined): void {
    let text: string | undefined;

    if (overlay !== undefined) {
      text = overlay.text;
    } else {
      text = read_workspace_file(uri);
    }

    if (text === undefined) {
      this.#files.delete(uri);
    } else {
      const existing = this.#files.get(uri);
      const hash = document_content_hash(text);

      if (
        existing === undefined || existing.content_hash !== hash ||
        existing.text !== text
      ) {
        this.#files.set(uri, workspace_file(uri, text));
      }
    }

    this.rebuild_graph();
  }

  text(uri: string, overlays: readonly TextDocument[]): string | undefined {
    const overlay = overlays.find((document) => document.uri === uri);

    if (overlay !== undefined) {
      return overlay.text;
    }

    return this.#files.get(uri)?.text;
  }

  entries(overlays: readonly TextDocument[]): WorkspaceAnalysisEntry[] {
    return this.analysis_entries(this.#files.keys(), overlays);
  }

  entries_for_uri(
    uri: string,
    overlays: readonly TextDocument[],
  ): WorkspaceAnalysisEntry[] {
    const related = new Set<string>([uri]);
    const dependencies = this.#dependencies.get(uri);

    if (dependencies !== undefined) {
      for (const dependency of dependencies) {
        if (this.#files.has(dependency)) {
          related.add(dependency);
        }

        const sibling_importers = this.#reverse_dependencies.get(dependency);

        if (sibling_importers !== undefined) {
          for (const importer of sibling_importers) {
            related.add(importer);
          }
        }
      }
    }

    const importers = this.#reverse_dependencies.get(uri);

    if (importers !== undefined) {
      for (const importer of importers) {
        related.add(importer);
      }
    }

    return this.analysis_entries(
      related,
      overlays.filter((document) => related.has(document.uri)),
    );
  }

  symbols(
    overlays: readonly TextDocument[],
    query: string,
    encoding: PositionEncoding,
  ): LspWorkspaceSymbol[] {
    const overlay_by_uri = new Map(
      overlays.map((document) => [document.uri, document]),
    );
    const matches: {
      score: number;
      start: LspWorkspaceSymbol["location"]["range"]["start"];
      symbol: LspWorkspaceSymbol;
    }[] = [];

    for (const file of this.#files.values()) {
      if (!file_has_symbol_candidate(file, query)) {
        continue;
      }

      const overlay = overlay_by_uri.get(file.uri);
      let text = file.text;
      let symbol_sites = file.symbol_sites;

      if (overlay !== undefined && overlay.text !== file.text) {
        text = overlay.text;
        symbol_sites = source_metadata(overlay.text, overlay.uri).symbol_sites;
      }

      collect_workspace_symbols(
        matches,
        file.uri,
        text,
        symbol_sites,
        query,
        encoding,
      );
      overlay_by_uri.delete(file.uri);
    }

    for (const overlay of overlay_by_uri.values()) {
      const symbol_sites = source_metadata(overlay.text, overlay.uri)
        .symbol_sites;
      collect_workspace_symbols(
        matches,
        overlay.uri,
        overlay.text,
        symbol_sites,
        query,
        encoding,
      );
    }

    matches.sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const by_name = left.symbol.name.localeCompare(right.symbol.name);

      if (by_name !== 0) {
        return by_name;
      }

      const by_uri = left.symbol.location.uri.localeCompare(
        right.symbol.location.uri,
      );

      if (by_uri !== 0) {
        return by_uri;
      }

      if (left.start.line !== right.start.line) {
        return left.start.line - right.start.line;
      }

      return left.start.character - right.start.character;
    });

    return matches.map((match) => match.symbol);
  }

  private analysis_entries(
    uris: Iterable<string>,
    overlays: readonly TextDocument[],
  ): WorkspaceAnalysisEntry[] {
    const overlay_by_uri = new Map(
      overlays.map((document) => [document.uri, document]),
    );
    const entries: WorkspaceAnalysisEntry[] = [];

    for (const uri of uris) {
      const file = this.#files.get(uri);

      if (file === undefined) {
        continue;
      }

      const overlay = overlay_by_uri.get(file.uri);

      if (overlay === undefined || overlay.text === file.text) {
        entries.push(analyze_cached_workspace_file(file));
      } else {
        entries.push(analyze_workspace_file(file.uri, overlay.text));
      }

      overlay_by_uri.delete(file.uri);
    }

    for (const overlay of overlay_by_uri.values()) {
      entries.push(analyze_workspace_file(overlay.uri, overlay.text));
    }

    entries.sort((left, right) => left.uri.localeCompare(right.uri));
    return entries;
  }

  affected_dependents(
    uri: string,
    max_depth: number,
    max_fanout: number,
  ): string[] {
    const affected: string[] = [];
    const visited = new Set<string>([uri]);
    const pending = [{ uri, depth: 0 }];

    while (pending.length > 0 && affected.length < max_fanout) {
      const next = pending.shift();

      if (next === undefined) {
        throw new Error("Missing workspace dependency traversal item");
      }

      if (next.depth >= max_depth) {
        continue;
      }

      const importers = this.#reverse_dependencies.get(next.uri);

      if (importers === undefined) {
        continue;
      }

      for (const importer of [...importers].sort()) {
        if (visited.has(importer)) {
          continue;
        }

        visited.add(importer);
        affected.push(importer);

        if (affected.length >= max_fanout) {
          break;
        }

        pending.push({ uri: importer, depth: next.depth + 1 });
      }
    }

    return affected;
  }

  dependency_count(): number {
    let count = 0;

    for (const dependencies of this.#dependencies.values()) {
      count += dependencies.size;
    }

    return count;
  }

  file_count(): number {
    return this.#files.size;
  }

  analysis_count(): number {
    let count = 0;

    for (const file of this.#files.values()) {
      if (file.analysis !== undefined) {
        count += 1;
      }
    }

    return count;
  }

  private rebuild_graph(): void {
    this.#dependencies.clear();
    this.#reverse_dependencies.clear();

    for (const file of this.#files.values()) {
      const dependencies = file.dependencies;
      this.#dependencies.set(file.uri, dependencies);

      for (const dependency of dependencies) {
        let importers = this.#reverse_dependencies.get(dependency);

        if (importers === undefined) {
          importers = new Set();
          this.#reverse_dependencies.set(dependency, importers);
        }

        importers.add(file.uri);
      }
    }
  }
}

export function workspace_definition_location(
  entries: WorkspaceAnalysisEntry[],
  current_uri: string,
  offset: number,
  encoding: PositionEncoding,
): LspLocation | undefined {
  const target = workspace_target(entries, current_uri, offset);

  if (target === undefined) {
    return undefined;
  }

  const definition = target.entity.definition;

  if (definition === undefined) {
    return undefined;
  }

  const occurrence = target.entry.index.occurrences.get(definition);

  if (occurrence === undefined) {
    throw new Error("Missing workspace target definition occurrence");
  }

  return definition_location(
    target.entry.index,
    target.entry.text,
    target.entry.uri,
    occurrence.span.start,
    encoding,
  );
}

export function workspace_reference_locations(
  entries: WorkspaceAnalysisEntry[],
  current_uri: string,
  offset: number,
  include_declaration: boolean,
  encoding: PositionEncoding,
): LspLocation[] {
  const target = workspace_target(entries, current_uri, offset);

  if (target === undefined) {
    return [];
  }

  const locations: LspLocation[] = [];
  const definition = target.entity.definition;

  if (definition !== undefined) {
    const occurrence = target.entry.index.occurrences.get(definition);

    if (occurrence === undefined) {
      throw new Error("Missing workspace reference target definition");
    }

    locations.push(...reference_locations(
      target.entry.index,
      target.entry.text,
      target.entry.uri,
      occurrence.span.start,
      include_declaration,
      encoding,
    ));
  }

  for (const entry of entries) {
    for (
      const occurrence of imported_member_occurrences(
        entry,
        target.entry.uri,
        target.entity.name,
      )
    ) {
      locations.push({
        uri: entry.uri,
        range: range_from_offsets(
          new PositionIndex(entry.text, encoding),
          occurrence.start,
          occurrence.end,
        ),
      });
    }
  }

  return unique_locations(locations);
}

export function workspace_rename_symbol(
  entries: WorkspaceAnalysisEntry[],
  current_uri: string,
  offset: number,
  new_name: string,
  encoding: PositionEncoding,
): LspWorkspaceEdit | undefined {
  const target = workspace_target(entries, current_uri, offset);

  if (target === undefined || target.entity.definition === undefined) {
    return undefined;
  }

  const definition = target.entry.index.occurrences.get(
    target.entity.definition,
  );

  if (definition === undefined) {
    throw new Error("Missing workspace rename target definition");
  }

  const local = rename_symbol(
    target.entry.index,
    target.entry.text,
    target.entry.uri,
    definition.span.start,
    new_name,
    encoding,
  );

  if (local === undefined) {
    return undefined;
  }

  const changes = { ...local.changes };

  for (const entry of entries) {
    const imported = imported_member_occurrences(
      entry,
      target.entry.uri,
      target.entity.name,
    );

    if (imported.length === 0) {
      continue;
    }

    const positions = new PositionIndex(entry.text, encoding);
    let edits = changes[entry.uri];

    if (edits === undefined) {
      edits = [];
      changes[entry.uri] = edits;
    }

    for (const occurrence of imported) {
      edits.push({
        range: range_from_offsets(
          positions,
          occurrence.start,
          occurrence.end,
        ),
        newText: new_name,
      });
    }
  }

  return { changes };
}

export function discover_workspace_roots(candidates: string[]): string[] {
  const roots = new Set<string>();

  for (const candidate of candidates) {
    const discovered = discover_workspace_root(candidate);

    if (discovered !== undefined) {
      roots.add(discovered);
    }
  }

  return [...roots].sort();
}

function discover_workspace_root(candidate: string): string | undefined {
  let url: URL;

  try {
    url = new URL(candidate);
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }

  if (url.protocol !== "file:") {
    return undefined;
  }

  try {
    const stat = Deno.statSync(url);

    if (stat.isFile) {
      url = new URL(".", url);
    }
  } catch (error) {
    if (
      !(error instanceof Deno.errors.NotFound) &&
      !(error instanceof Deno.errors.PermissionDenied)
    ) {
      throw error;
    }
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  const fallback = url.href;

  while (true) {
    if (workspace_marker_exists(url)) {
      return url.href;
    }

    const parent = new URL("..", url);

    if (parent.href === url.href) {
      return fallback;
    }

    url = parent;
  }
}

function workspace_marker_exists(directory: URL): boolean {
  for (const marker of ["AGENTS.md", ".git"]) {
    try {
      Deno.statSync(new URL(marker, directory));
      return true;
    } catch (error) {
      if (
        error instanceof Deno.errors.NotFound ||
        error instanceof Deno.errors.PermissionDenied
      ) {
        continue;
      }

      throw error;
    }
  }

  return false;
}

function workspace_duck_files(roots: string[]): string[] {
  const files = new Set<string>();

  for (const root of roots) {
    let url: URL;

    try {
      url = new URL(root);
    } catch (error) {
      if (error instanceof TypeError) {
        continue;
      }

      throw error;
    }

    collect_workspace_files(url, files);
  }

  return [...files].sort();
}

function collect_workspace_files(url: URL, files: Set<string>): void {
  let stat: Deno.FileInfo;

  try {
    stat = Deno.statSync(url);
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.PermissionDenied
    ) {
      return;
    }

    throw error;
  }

  if (stat.isFile) {
    if (url.pathname.endsWith(".duck")) {
      files.add(url.href);
    }

    return;
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  let entries: Deno.DirEntry[];

  try {
    entries = [...Deno.readDirSync(url)].sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.PermissionDenied
    ) {
      return;
    }

    throw error;
  }

  for (const entry of entries) {
    if (entry.isSymlink || ignored_directory(entry.name)) {
      continue;
    }

    const child = new URL(encodeURIComponent(entry.name), url);

    if (entry.isDirectory) {
      child.pathname += "/";
      collect_workspace_files(child, files);
    } else if (entry.isFile && entry.name.endsWith(".duck")) {
      files.add(child.href);
    }
  }
}

function ignored_directory(name: string): boolean {
  return name === ".git" || name === ".claude" || name === ".codex" ||
    name === "node_modules" || name === "target" || name === "vendor" ||
    name === ".deno";
}

function read_workspace_file(uri: string): string | undefined {
  let url: URL;

  try {
    url = new URL(uri);
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }

  if (url.protocol !== "file:") {
    return undefined;
  }

  try {
    return Deno.readTextFileSync(url);
  } catch (error) {
    if (
      error instanceof Deno.errors.NotFound ||
      error instanceof Deno.errors.PermissionDenied
    ) {
      return undefined;
    }

    throw error;
  }
}

function analyze_workspace_file(
  uri: string,
  text: string,
): WorkspaceAnalysisEntry {
  const parsed = Source.parse_with_diagnostics(text);
  return {
    uri,
    text,
    source: parsed.source,
    index: build_binding_index(parsed, 0),
    content_hash: document_content_hash(text),
  };
}

function workspace_file(uri: string, text: string): CachedWorkspaceFile {
  const metadata = source_metadata(text, uri);

  return {
    analysis: undefined,
    content_hash: document_content_hash(text),
    dependencies: metadata.dependencies,
    names: metadata.names,
    symbol_sites: metadata.symbol_sites,
    text,
    uri,
  };
}

function analyze_cached_workspace_file(
  file: CachedWorkspaceFile,
): WorkspaceAnalysisEntry {
  if (file.analysis === undefined) {
    file.analysis = analyze_workspace_file(file.uri, file.text);
  }

  return file.analysis;
}

function source_metadata(
  text: string,
  uri: string,
): {
  dependencies: Set<string>;
  names: Set<string>;
  symbol_sites: WorkspaceSymbolSite[];
} {
  const dependencies = new Set<string>();
  const symbol_sites: WorkspaceSymbolSite[] = [];
  const tokens = source_tokens(scan_source(text));
  let brace_depth = 0;
  let declaration_container: string | undefined;
  let declaration_kind: number = symbol_kind.class;
  let declaration_member_kind: number = symbol_kind.field;
  let declaration_members = false;
  let declaration_parameters = false;
  let module_parameters = false;
  let binding_kind: number = symbol_kind.variable;
  let binding_pattern = false;
  let positional_binding_pattern = false;
  let shape_binding_pattern = false;
  let shape_binding_site_index: number | undefined;
  let type_binding_pattern = false;
  let expects_top_level_name = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    const path = tokens[index + 1];
    let introduced_symbol = false;

    if (token?.kind === "symbol" && token.text === "{") {
      brace_depth += 1;

      if (
        binding_pattern && expects_top_level_name && !type_binding_pattern
      ) {
        shape_binding_pattern = true;
      }
    } else if (token?.kind === "symbol" && token.text === "}") {
      brace_depth -= 1;

      if (brace_depth === 0) {
        declaration_members = false;
        declaration_parameters = false;
      }
    }

    if (brace_depth === 0 && token?.kind === "name") {
      if (module_parameters) {
        if (token.text === "where") {
          module_parameters = false;
        } else if (
          previous?.kind === "symbol" &&
          (previous.text === "!" || previous.text === "(" ||
            previous.text === ",")
        ) {
          symbol_sites.push({
            container_name: undefined,
            end: token.span.end,
            kind: symbol_kind.module,
            name: token.text,
            start: token.span.start,
          });
        }
      } else if (
        declaration_members && !declaration_parameters &&
        token.text === "packed"
      ) {
        declaration_members = false;
      } else if (
        token.text === "declare" && path?.kind === "name" &&
        path.text !== "effect"
      ) {
        declaration_kind = symbol_kind.class;
        declaration_member_kind = symbol_kind.field;
        declaration_members = true;
        declaration_parameters = false;
        module_parameters = false;
        binding_pattern = false;
        positional_binding_pattern = false;
        shape_binding_pattern = false;
        type_binding_pattern = false;
        expects_top_level_name = true;
      } else if (
        token.text === "type" || token.text === "effect" ||
        token.text === "duck" || token.text === "record"
      ) {
        declaration_kind = symbol_kind.class;
        declaration_member_kind = symbol_kind.field;

        if (token.text === "effect") {
          declaration_kind = symbol_kind.interface;
          declaration_member_kind = symbol_kind.method;
        }

        declaration_members = true;
        declaration_parameters = false;
        module_parameters = false;
        binding_pattern = false;
        positional_binding_pattern = false;
        shape_binding_pattern = false;
        type_binding_pattern = false;
        expects_top_level_name = true;
      } else if (
        (token.text === "let" || token.text === "const") &&
        (previous === undefined || previous.kind === "newline")
      ) {
        declaration_members = false;
        declaration_parameters = false;
        module_parameters = false;
        binding_pattern = true;
        positional_binding_pattern = false;
        shape_binding_pattern = false;
        type_binding_pattern = false;
        expects_top_level_name = true;
        binding_kind = symbol_kind.variable;

        if (token.text === "const") {
          binding_kind = symbol_kind.constant;
        }
      } else if (token.text === "module") {
        declaration_members = false;
        declaration_parameters = false;
        module_parameters = path?.kind === "symbol" && path.text === "(";
        binding_pattern = !module_parameters;
        binding_kind = symbol_kind.constant;
        positional_binding_pattern = false;
        shape_binding_pattern = false;
        type_binding_pattern = false;
        expects_top_level_name = !module_parameters;
      } else if (
        binding_pattern && expects_top_level_name &&
        (token.text === "struct" || token.text === "union")
      ) {
        type_binding_pattern = true;
        expects_top_level_name = false;
      } else if (
        expects_top_level_name &&
        token.text !== "rec" && token.text !== "open" &&
        !(previous?.kind === "symbol" && previous.text === "`")
      ) {
        if (token.text !== "_") {
          const kind = declaration_members ? declaration_kind : binding_kind;
          symbol_sites.push({
            container_name: undefined,
            end: token.span.end,
            kind,
            name: token.text,
            start: token.span.start,
          });
          introduced_symbol = true;
        }

        expects_top_level_name = false;
        declaration_parameters = declaration_members;

        if (declaration_members) {
          declaration_container = token.text;
        }
      } else if (
        token.text === "and" &&
        (previous === undefined || previous.kind === "newline") &&
        path?.kind === "name" && path.text !== "_"
      ) {
        let definition = path;

        for (let prior_index = index - 1; prior_index >= 0; prior_index -= 1) {
          const prior = tokens[prior_index];

          if (prior?.kind === "name" && prior.text === path.text) {
            definition = prior;
            break;
          }
        }

        symbol_sites.push({
          container_name: undefined,
          end: definition.span.end,
          kind: binding_kind,
          name: path.text,
          start: definition.span.start,
        });
      } else if (
        !declaration_members && !binding_pattern &&
        token.text !== "_" && path?.kind === "symbol" && path.text === "<-"
      ) {
        symbol_sites.push({
          container_name: undefined,
          end: token.span.end,
          kind: symbol_kind.variable,
          name: token.text,
          start: token.span.start,
        });
      } else if (
        !declaration_members && !binding_pattern &&
        token.text !== "_" && path?.kind === "symbol" &&
        (path.text === "=" || path.text === ":=") &&
        (previous === undefined || previous.kind === "newline")
      ) {
        symbol_sites.push({
          container_name: undefined,
          end: token.span.end,
          kind: symbol_kind.variable,
          name: token.text,
          start: token.span.start,
        });
      }
    }

    if (
      binding_pattern && expects_top_level_name &&
      token?.kind === "symbol" &&
      (token.text === "[" || token.text === "(")
    ) {
      positional_binding_pattern = true;
    }

    if (
      brace_depth === 0 && binding_pattern && positional_binding_pattern &&
      !introduced_symbol && token?.kind === "name" && token.text !== "_" &&
      previous?.kind === "symbol" &&
      (previous.text === "[" || previous.text === "(" ||
        previous.text === ",")
    ) {
      symbol_sites.push({
        container_name: undefined,
        end: token.span.end,
        kind: binding_kind,
        name: token.text,
        start: token.span.start,
      });
      expects_top_level_name = false;
    }

    if (
      token?.kind === "name" &&
      previous?.kind === "symbol" &&
      ((previous.text === "`" && declaration_members) ||
        (previous.text === "." &&
          (declaration_members || shape_binding_pattern)))
    ) {
      let container_name: string | undefined;
      let kind: number = binding_kind;

      if (declaration_members) {
        container_name = declaration_container;
        kind = declaration_member_kind;

        if (previous.text === "`") {
          kind = symbol_kind.enum_member;
        }
      }

      symbol_sites.push({
        container_name,
        end: token.span.end,
        kind,
        name: token.text,
        start: token.span.start,
      });

      if (shape_binding_pattern && !declaration_members) {
        shape_binding_site_index = symbol_sites.length - 1;
      }
    }

    if (
      binding_pattern && brace_depth > 0 &&
      token?.kind === "name" && previous?.kind === "symbol" &&
      previous.text === "=" && shape_binding_site_index !== undefined
    ) {
      const site = symbol_sites[shape_binding_site_index];

      if (site === undefined) {
        throw new Error("Missing workspace shape binding symbol site");
      }

      if (token.text === "_") {
        symbol_sites.splice(shape_binding_site_index, 1);
      } else {
        site.end = token.span.end;
        site.name = token.text;
        site.start = token.span.start;
      }

      shape_binding_site_index = undefined;
    }

    if (
      declaration_members && brace_depth > 0 &&
      token?.kind === "name" && path?.kind === "symbol" &&
      path.text === ":" &&
      !(previous?.kind === "symbol" && previous.text === ".")
    ) {
      symbol_sites.push({
        container_name: declaration_container,
        end: token.span.end,
        kind: declaration_member_kind,
        name: token.text,
        start: token.span.start,
      });
    }

    if (
      brace_depth === 0 && token?.kind === "symbol" && token.text === "="
    ) {
      binding_pattern = false;
      positional_binding_pattern = false;
      shape_binding_pattern = false;
      shape_binding_site_index = undefined;
      type_binding_pattern = false;
      declaration_parameters = false;
      expects_top_level_name = false;
    }

    if (
      brace_depth === 0 && token?.kind === "newline" &&
      declaration_members && !declaration_parameters
    ) {
      let next_index = index + 1;

      while (tokens[next_index]?.kind === "newline") {
        next_index += 1;
      }

      const next = tokens[next_index];

      if (
        next === undefined || next.kind !== "symbol" || next.text !== "|"
      ) {
        declaration_members = false;
      }
    }

    if (
      token?.kind !== "name" || token.text !== "import" ||
      path?.kind !== "string"
    ) {
      continue;
    }

    try {
      dependencies.add(new URL(path.text, uri).href);
    } catch (error) {
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
  }

  return {
    dependencies,
    names: new Set(symbol_sites.map((site) => site.name)),
    symbol_sites,
  };
}

function file_has_symbol_candidate(
  file: CachedWorkspaceFile,
  query: string,
): boolean {
  for (const name of file.names) {
    if (fuzzy_score(name, query) !== undefined) {
      return true;
    }
  }

  return false;
}

function collect_workspace_symbols(
  matches: {
    score: number;
    start: LspWorkspaceSymbol["location"]["range"]["start"];
    symbol: LspWorkspaceSymbol;
  }[],
  uri: string,
  text: string,
  symbol_sites: WorkspaceSymbolSite[],
  query: string,
  encoding: PositionEncoding,
): void {
  const positions = new PositionIndex(text, encoding);

  for (const site of symbol_sites) {
    const score = fuzzy_score(site.name, query);

    if (score !== undefined) {
      const symbol: LspWorkspaceSymbol = {
        name: site.name,
        kind: site.kind,
        location: {
          uri,
          range: range_from_offsets(positions, site.start, site.end),
        },
      };

      if (site.container_name !== undefined) {
        symbol.containerName = site.container_name;
      }

      matches.push({
        score,
        start: symbol.location.range.start,
        symbol,
      });
    }
  }
}

function workspace_target(
  entries: WorkspaceAnalysisEntry[],
  current_uri: string,
  offset: number,
): WorkspaceTarget | undefined {
  const current = entries.find((entry) => entry.uri === current_uri);

  if (current === undefined) {
    return undefined;
  }

  const occurrence = current.index.occurrence_at(offset);

  if (occurrence === undefined) {
    return undefined;
  }

  if (occurrence.entity !== undefined) {
    const entity = current.index.entities.get(occurrence.entity);

    if (
      entity !== undefined && entity.scope === "scope:0" &&
      entity.owner === undefined && entity.kind !== "module_parameter"
    ) {
      return { entry: current, entity };
    }
  }

  const imported = imported_member_at(current, occurrence.span.start);

  if (imported === undefined) {
    return undefined;
  }

  let target_uri: string;

  try {
    target_uri = new URL(imported.path, current.uri).href;
  } catch (error) {
    if (error instanceof TypeError) {
      return undefined;
    }

    throw error;
  }

  const target_entry = entries.find((entry) => entry.uri === target_uri);

  if (target_entry === undefined) {
    return undefined;
  }

  const entity = root_entity_named(target_entry.index, occurrence.name);

  if (entity === undefined) {
    return undefined;
  }

  return { entry: target_entry, entity };
}

function root_entity_named(
  index: BindingIndex,
  name: string,
): BindingEntity | undefined {
  let result: BindingEntity | undefined;

  for (const entity of index.entities.values()) {
    if (
      entity.name !== name || entity.scope !== "scope:0" ||
      entity.owner !== undefined || entity.definition === undefined
    ) {
      continue;
    }

    if (result === undefined || result.generation < entity.generation) {
      result = entity;
    }
  }

  return result;
}

function imported_member_at(
  entry: WorkspaceAnalysisEntry,
  member_start: number,
): { alias: string; path: string } | undefined {
  const prefix_start = Math.max(0, member_start - 128);
  const prefix = entry.text.slice(prefix_start, member_start);
  const match = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*$/);

  if (match === null || match[1] === undefined) {
    return undefined;
  }

  const alias = match[1];
  const statement = entry.source.statements.find((candidate) =>
    candidate.tag === "bind" && candidate.name === alias &&
    candidate.value.tag === "import"
  );

  if (
    statement === undefined || statement.tag !== "bind" ||
    statement.value.tag !== "import"
  ) {
    return undefined;
  }

  return { alias, path: statement.value.path };
}

function imported_member_occurrences(
  entry: WorkspaceAnalysisEntry,
  target_uri: string,
  member_name: string,
): { start: number; end: number }[] {
  const result: { start: number; end: number }[] = [];

  for (const occurrence of entry.index.occurrences.values()) {
    if (occurrence.name !== member_name) {
      continue;
    }

    const imported = imported_member_at(entry, occurrence.span.start);

    if (imported === undefined) {
      continue;
    }

    let uri: string;

    try {
      uri = new URL(imported.path, entry.uri).href;
    } catch (error) {
      if (error instanceof TypeError) {
        continue;
      }

      throw error;
    }

    if (uri === target_uri) {
      result.push(occurrence.span);
    }
  }

  return result;
}

function unique_locations(locations: LspLocation[]): LspLocation[] {
  const seen = new Set<string>();
  const result: LspLocation[] = [];

  locations.sort((left, right) => {
    const by_uri = left.uri.localeCompare(right.uri);

    if (by_uri !== 0) {
      return by_uri;
    }

    if (left.range.start.line !== right.range.start.line) {
      return left.range.start.line - right.range.start.line;
    }

    return left.range.start.character - right.range.start.character;
  });

  for (const location of locations) {
    const key = JSON.stringify(location);

    if (!seen.has(key)) {
      seen.add(key);
      result.push(location);
    }
  }

  return result;
}

function range_from_offsets(
  positions: PositionIndex,
  start: number,
  end: number,
) {
  return {
    start: positions.position_from_offset(start),
    end: positions.position_from_offset(end),
  };
}
