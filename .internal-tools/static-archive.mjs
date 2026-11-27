import { createHash } from "node:crypto";
import yauzl from "yauzl";

export const DEFAULT_LIMITS = Object.freeze({
  compressedBytes: 128 * 1024 * 1024,
  unpackedBytes: 512 * 1024 * 1024,
  fileBytes: 64 * 1024 * 1024,
  entries: 100000,
});

export function safeArchivePath(value, directory = false) {
  if (typeof value !== "string" || /[\x00-\x1f\x7f\\:]/.test(value) || value.startsWith("/")) {
    throw new Error("Archive contains an unsafe path");
  }
  const normalized = directory && value.endsWith("/") ? value.slice(0, -1) : value;
  if (!normalized || normalized !== normalized.normalize("NFC")) throw new Error("Archive path is not canonical");
  for (const part of normalized.split("/")) {
    if (!part || part === "." || part === ".." || /^\.git/i.test(part) || /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) {
      throw new Error("Archive contains a traversal, Git-control, or reserved path");
    }
  }
  return normalized;
}

function boundedSize(value, limit, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit) throw new Error("Archive exceeds " + label);
}

function openZip(buffer) {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, {
    lazyEntries: true,
    autoClose: false,
    validateEntrySizes: true,
    strictFileNames: true,
  }, (error, zip) => error ? reject(error) : resolve(zip)));
}

// Validate every central-directory entry before opening any entry data stream.
function inspectEntries(zip, limits, allowedPaths) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const paths = new Map();
    let declaredBytes = 0;
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("entry", (entry) => {
      try {
        if (entries.length >= limits.entries) throw new Error("Archive exceeds entry count");
        if (entry.generalPurposeBitFlag & 1) throw new Error("Encrypted archives are forbidden");
        if (![0, 8].includes(entry.compressionMethod)) throw new Error("Unsupported archive compression");
        const directory = entry.fileName.endsWith("/");
        const name = safeArchivePath(entry.fileName, directory);
        const mode = entry.externalFileAttributes >>> 16;
        const kind = mode & 0o170000;
        if (kind && kind !== (directory ? 0o040000 : 0o100000)) throw new Error("Archive symlinks and special files are forbidden");
        if (!directory && (mode & 0o111)) throw new Error("Executable archive files are forbidden");
        boundedSize(entry.uncompressedSize, directory ? 0 : limits.fileBytes, "file size");
        boundedSize(entry.compressedSize, limits.compressedBytes, "compressed entry size");
        declaredBytes += entry.uncompressedSize;
        boundedSize(declaredBytes, limits.unpackedBytes, "unpacked size");
        const key = name.toLowerCase();
        if (paths.has(key)) throw new Error("Duplicate or case-conflicting archive path");
        if (!directory && allowedPaths && !allowedPaths.has(name)) throw new Error("Unexpected archive file");
        paths.set(key, { name, directory });
        entries.push({ entry, name, directory });
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.on("end", () => {
      if (finished) return;
      try {
        for (const { name } of entries) {
          const parts = name.split("/");
          for (let length = 1; length < parts.length; length++) {
            const parent = paths.get(parts.slice(0, length).join("/").toLowerCase());
            if (parent && !parent.directory) throw new Error("Archive file conflicts with a parent directory");
          }
        }
        finished = true;
        resolve(entries.filter((entry) => !entry.directory));
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });
}

function readEntry(zip, entry, limit) {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error) return reject(error);
    const chunks = [];
    let bytes = 0;
    stream.on("error", reject);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit || bytes > entry.uncompressedSize) {
        stream.destroy(new Error("Archive data exceeds declared size or file limit"));
      } else {
        chunks.push(chunk);
      }
    });
    stream.on("end", () => {
      if (bytes !== entry.uncompressedSize) return reject(new Error("Archive data size mismatch"));
      resolve(Buffer.concat(chunks));
    });
  }));
}

export async function readStaticArchive(buffer, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid archive limit");
  }
  boundedSize(buffer.length, limits.compressedBytes, "compressed size");
  const allowedPaths = options.allowedPaths ? new Set(options.allowedPaths) : null;
  if (allowedPaths) for (const name of allowedPaths) safeArchivePath(name);
  const zip = await openZip(buffer);
  try {
    const entries = await inspectEntries(zip, limits, allowedPaths);
    if (!entries.length) throw new Error("Archive contains no static files");
    const files = new Map();
    let actualBytes = 0;
    for (const { entry, name } of entries) {
      const content = await readEntry(zip, entry, limits.fileBytes);
      actualBytes += content.length;
      boundedSize(actualBytes, limits.unpackedBytes, "unpacked size");
      if (options.jsonOnly) {
        try { JSON.parse(content.toString("utf8")); }
        catch { throw new Error("Artifact contains invalid JSON data"); }
      }
      const oid = createHash("sha1").update("blob " + content.length + "\0").update(content).digest("hex");
      files.set(name, { oid, contents: content.toString("base64") });
    }
    if (allowedPaths && [...allowedPaths].some((name) => !files.has(name))) throw new Error("Archive is missing a required file");
    return files;
  } finally {
    zip.close();
  }
}
