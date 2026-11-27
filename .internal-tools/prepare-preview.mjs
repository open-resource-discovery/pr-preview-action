#!/usr/bin/env node
import { cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SEARCH_STYLE =
  '<style id="pr-preview-search-disabled">' + ".navbar__search,.navbar-sidebar__search{display:none!important}</style>";

// Recognize complete tags and skip raw-text elements without rewriting the HTML.
// This keeps comments, quoted attributes, and strings such as "</head>" intact.
export function hideDocumentationSearch(html) {
  const tags = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[a-z][a-z0-9:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
  const rawText = new Set(["script", "style", "title", "textarea", "xmp", "iframe", "noembed", "noframes"]);
  let isDocusaurus = false;
  let hasSearchStyle = false;
  for (let token = tags.exec(html); token; token = tags.exec(html)) {
    const tag = /^<(\/?)([a-z][a-z0-9:-]*)\b/i.exec(token[0]);
    if (!tag) continue;
    const closing = Boolean(tag[1]);
    const name = tag[2].toLowerCase();
    if (closing && name === "head") {
      return isDocusaurus && !hasSearchStyle
        ? html.slice(0, token.index) + SEARCH_STYLE + html.slice(token.index)
        : html;
    }
    if (closing) continue;
    const attributes = new Map();
    const attributePattern = /\s([^\s/>=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g;
    for (const attribute of token[0].slice(tag[0].length).matchAll(attributePattern)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? attribute[4] ?? "");
    }
    if (name === "meta" && attributes.get("name")?.toLowerCase() === "generator") {
      isDocusaurus ||= attributes.get("content")?.toLowerCase().startsWith("docusaurus") ?? false;
    }
    if (name === "style" && attributes.get("id") === "pr-preview-search-disabled") hasSearchStyle = true;
    if (rawText.has(name)) {
      const end = new RegExp("</" + name + "\\s*[^>]*>", "gi");
      end.lastIndex = tags.lastIndex;
      if (!end.exec(html)) return html;
      tags.lastIndex = end.lastIndex;
    }
  }
  return html;
}

export function isSearchIndex(name) {
  return /^search-index.*\.json(?:\.(?:gz|br))?$/.test(name);
}

function contains(parent, child) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(".." + sep);
}

function canonicalPath(path) {
  path = resolve(path);
  try {
    return realpathSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return join(canonicalPath(dirname(path)), basename(path));
  }
}

function hideSearchInPages(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) hideSearchInPages(path);
    else if (entry.isFile() && entry.name.endsWith(".html")) {
      let html;
      try {
        html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(readFileSync(path));
      } catch (error) {
        if (error.code === "ERR_ENCODING_INVALID_ENCODED_DATA") continue;
        throw error;
      }
      const updated = hideDocumentationSearch(html);
      if (updated !== html) writeFileSync(path, updated);
    }
  }
}

export function preparePreview(source, destination, includeSearchIndexes = false) {
  source = realpathSync(source);
  destination = canonicalPath(destination);
  if (!lstatSync(source).isDirectory()) throw new Error("build-dir must be an existing directory");
  if (contains(destination, source)) throw new Error("the deployment copy must not contain build-dir");
  let excludedCount = 0;
  function copyDirectory(from, to) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const path = join(from, entry.name);
      // Support build-dir='.' without copying staging into itself.
      if (path === destination) continue;
      if (!includeSearchIndexes && isSearchIndex(entry.name)) {
        excludedCount++;
        continue;
      }
      const output = join(to, entry.name);
      if (entry.isDirectory()) copyDirectory(path, output);
      else cpSync(path, output, { dereference: false, verbatimSymlinks: true });
    }
  }
  copyDirectory(source, destination);
  if (excludedCount) hideSearchInPages(destination);
  return excludedCount;
}

export function main(args) {
  if (args.length !== 3 || !/^(true|false)$/i.test(args[2])) {
    console.error("usage: prepare-preview.mjs <build-dir> <output-dir> <include-search-indexes:true|false>");
    return 1;
  }
  try {
    const count = preparePreview(args[0], args[1], args[2].toLowerCase() === "true");
    console.log("Prepared preview; excluded " + count + " generated search index files.");
    return 0;
  } catch (error) {
    console.error("Could not prepare preview: " + error.message);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
