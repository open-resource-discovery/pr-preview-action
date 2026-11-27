import { createHash } from "node:crypto";

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

export function prepareStaticPreview(files, includeSearchIndexes = false) {
  const desired = new Map(files);
  let removed = 0;
  if (!includeSearchIndexes) {
    for (const name of desired.keys()) {
      if (isSearchIndex(name.split("/").at(-1))) {
        desired.delete(name);
        removed++;
      }
    }
  }
  if (!removed) return desired;
  for (const [name, entry] of desired) {
    if (!name.endsWith(".html")) continue;
    const content = Buffer.from(entry.contents, "base64");
    let html;
    try {
      html = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
    } catch {
      continue;
    }
    const updated = hideDocumentationSearch(html);
    if (updated === html) continue;
    const buffer = Buffer.from(updated);
    const oid = createHash("sha1")
      .update("blob " + buffer.length + String.fromCharCode(0))
      .update(buffer)
      .digest("hex");
    desired.set(name, { ...entry, oid, contents: buffer.toString("base64") });
  }
  return desired;
}
