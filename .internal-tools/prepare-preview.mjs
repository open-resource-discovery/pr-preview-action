#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { hideDocumentationSearch, isSearchIndex } from "./preview-content.mjs";
export { SEARCH_STYLE, hideDocumentationSearch, isSearchIndex } from "./preview-content.mjs";

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
      if (updated !== html) {
        const mode = lstatSync(path).mode;
        const readOnly = (mode & 0o200) === 0;
        if (readOnly) chmodSync(path, mode | 0o200);
        try {
          writeFileSync(path, updated);
        } finally {
          if (readOnly) chmodSync(path, mode);
        }
      }
    }
  }
}

export function preparePreview(source, destination, includeSearchIndexes = false) {
  source = realpathSync(source.startsWith("~") ? homedir() + source.slice(1) : source);
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
      if (!entry.isDirectory() && !includeSearchIndexes && isSearchIndex(entry.name)) {
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
