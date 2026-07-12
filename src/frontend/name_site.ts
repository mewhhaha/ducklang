import { expect } from "../expect.ts";
import type { Token } from "./ast.ts";
import type { SourceSpan } from "./syntax.ts";

/** An exact spelling of a source name owned by an AST object. */
export type NameSite = {
  slot: string;
  index: number | undefined;
  name: string;
  span: SourceSpan;
};

const sites_by_owner = new WeakMap<object, NameSite[]>();

export function record_name_site(
  owner: object,
  slot: string,
  name: string,
  span: SourceSpan,
  index: number | undefined = undefined,
): void {
  expect(span.end >= span.start, "Invalid name site span");
  const sites = sites_by_owner.get(owner);
  const site = { slot, index, name, span };

  if (sites) {
    sites.push(site);
    return;
  }

  sites_by_owner.set(owner, [site]);
}

export function name_sites(owner: object): readonly NameSite[] {
  const sites = sites_by_owner.get(owner);

  if (sites) {
    return sites;
  }

  return [];
}

/** Preserve source spellings when a parser rewrite creates a replacement node. */
export function copy_name_sites(source: object, target: object): void {
  const sites = name_sites(source).map((site) => ({ ...site }));
  sites_by_owner.set(target, sites);
}

function has_name_sites(owner: object): boolean {
  return sites_by_owner.has(owner);
}

/**
 * Records direct name properties of a concrete parser node. The caller gives
 * exactly the consumed tokens for that node, so parser checkpoints naturally
 * discard sites along with discarded syntax.
 */
export function record_node_name_sites(owner: object, tokens: Token[]): void {
  if (has_name_sites(owner)) {
    return;
  }

  const value = owner as Record<string, unknown>;
  const names: {
    slot: string;
    index: number | undefined;
    name: string;
    prefer_last: boolean;
  }[] = [];

  for (
    const slot of [
      "name",
      "type_name",
      "case_name",
      "value_name",
      "effect",
      "operation",
    ]
  ) {
    const name = value[slot];

    if (typeof name === "string" && name !== "object_type") {
      names.push({
        slot,
        index: undefined,
        name,
        prefer_last: value.tag === "field",
      });
    }
  }

  for (const slot of ["params", "items"]) {
    const entries = value[slot];

    if (!Array.isArray(entries)) continue;

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      let name: string | undefined;

      if (typeof entry === "string") {
        name = entry;
      } else if (entry !== null && typeof entry === "object") {
        const entry_record = entry as Record<string, unknown>;
        if (typeof entry_record.name === "string") {
          name = entry_record.name;
        }
      }

      if (name !== undefined && !name.startsWith("item_")) {
        names.push({ slot, index, name, prefer_last: false });
      }
    }
  }

  for (const slot of ["left", "right", "index", "item"]) {
    const name = value[slot];
    if (typeof name === "string") {
      names.push({ slot, index: undefined, name, prefer_last: false });
    }
  }

  if (typeof value.annotation === "string") {
    const colon = tokens.findIndex((token) =>
      token.kind === "symbol" && token.text === ":"
    );

    if (colon >= 0) {
      let annotation_index = 0;

      for (let index = colon + 1; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === undefined) continue;
        if (
          token.kind === "symbol" &&
          (token.text === "=" || token.text === "," || token.text === ")" ||
            token.text === "=>")
        ) {
          break;
        }
        if (token.kind === "name") {
          record_name_site(
            owner,
            "annotation",
            token.text,
            token.span,
            annotation_index,
          );
          annotation_index += 1;
        }
      }
    }
  }

  let next_token = 0;

  for (const candidate of names) {
    let found: { token: Token; index: number } | undefined;

    if (candidate.prefer_last) {
      for (let index = tokens.length - 1; index >= 0; index -= 1) {
        const current = tokens[index];
        if (
          current && current.kind === "name" && current.text === candidate.name
        ) {
          found = { token: current, index };
          break;
        }
      }
    } else {
      found = find_next_name(tokens, next_token, candidate.name);
    }

    if (found) {
      record_name_site(
        owner,
        candidate.slot,
        candidate.name,
        found.token.span,
        candidate.index,
      );
      next_token = found.index + 1;
    }
  }

  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (entry !== null && typeof entry === "object") {
            record_node_name_sites(entry, tokens);
          }
        }
      } else {
        record_node_name_sites(child, tokens);
      }
    }
  }
}

/** Attach exact references inside a parsed annotation tree. */
export function record_annotation_name_sites(
  value: object,
  tokens: Token[],
): void {
  let token_index = 0;
  const visit = (node: object): void => {
    const record = node as Record<string, unknown>;
    const tag = record.tag;

    if (
      (tag === "name" || tag === "atom" || tag === "family" ||
        tag === "variable") && typeof record.name === "string"
    ) {
      const found = find_next_name(tokens, token_index, record.name);
      expect(found, "Missing annotation name token: " + record.name);
      token_index = found.index + 1;
      record_name_site(node, "name", record.name, found.token.span);
    }

    if (tag === "operation") {
      for (const slot of ["effect", "operation"]) {
        const name = record[slot];
        expect(typeof name === "string", "Missing effect operation name");
        const found = find_next_name(tokens, token_index, name);
        expect(found, "Missing annotation name token: " + name);
        token_index = found.index + 1;
        record_name_site(node, slot, name, found.token.span);
      }
    }

    for (const child of Object.values(record)) {
      if (child !== null && typeof child === "object") {
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (entry !== null && typeof entry === "object") visit(entry);
          }
        } else {
          visit(child);
        }
      }
    }
  };

  visit(value);
}

function find_next_name(
  tokens: Token[],
  start: number,
  name: string,
): { token: Token; index: number } | undefined {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token && token.kind === "name" && token.text === name) {
      return { token, index };
    }
  }
  return undefined;
}
