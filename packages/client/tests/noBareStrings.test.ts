/**
 * The acceptance criterion of #15: every user-visible string resolves through a
 * key (§11). A regex would trip over TypeScript generics, so the sources are
 * parsed and their JSX walked — text nodes and the handful of attributes the user
 * actually reads.
 *
 * Decorative glyphs (the rotate arrow) carry no letters or digits and are not
 * language, so they are allowed; anything with a word in it is not.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Vitest runs with the client package as its root.
const SRC = resolve(process.cwd(), "src");

/** Attributes whose value the user reads. `className` and friends are not. */
const VISIBLE_ATTRIBUTES = new Set(["aria-label", "placeholder", "title", "alt", "aria-valuetext"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

function isLanguage(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

function bareStrings(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && isLanguage(node.text)) {
      found.push(node.text.trim());
    }
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
      const name = node.name.text;
      const initializer = node.initializer;
      if (
        VISIBLE_ATTRIBUTES.has(name) &&
        initializer !== undefined &&
        ts.isStringLiteral(initializer)
      ) {
        found.push(`${name}="${initializer.text}"`);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

describe("no bare strings", () => {
  const files = sources(SRC);

  it("finds the components to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${relative(SRC, file)} renders nothing but keys`, () => {
      expect(bareStrings(file)).toEqual([]);
    });
  }
});
