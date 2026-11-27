import assert from "node:assert/strict";
import test from "node:test";
import yazl from "yazl";
import { readStaticArchive } from "../.internal-tools/static-archive.mjs";

async function makeZip(files) {
  const zip = new yazl.ZipFile();
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const [name, value] of files) zip.addBuffer(Buffer.from(value), name, { mode: 0o100644 });
  zip.end();
  return output;
}

function centralOffset(zip) {
  return zip.readUInt32LE(zip.length - 6);
}
function changeName(zip, name) {
  const result = Buffer.from(zip);
  assert.equal(Buffer.byteLength(name), 8);
  result.write(name, 30, "utf8");
  result.write(name, centralOffset(result) + 46, "utf8");
  return result;
}

test("reads static files only after inspecting the complete archive", async () => {
  const archive = await makeZip([
    ["index.html", "hello"],
    ["assets/main.js", "console.log('preview')"],
  ]);
  const files = await readStaticArchive(archive);
  assert.equal(Buffer.from(files.get("index.html").contents, "base64").toString(), "hello");
  assert.equal(files.size, 2);
});

for (const name of ["../x.txt", "/foo.txt", "foo\\barx", "C:/x.txt", ".git/x.y", "bad\0name"]) {
  test("rejects unsafe archive path " + JSON.stringify(name), async () => {
    const archive = await makeZip([["good.txt", "data"]]);
    await assert.rejects(readStaticArchive(changeName(archive, name)));
  });
}

for (const [kind, mode] of [
  ["symlink", 0o120777],
  ["FIFO", 0o010644],
  ["executable", 0o100755],
]) {
  test("rejects " + kind + " entries before decompression", async () => {
    const archive = await makeZip([["good.txt", "data"]]);
    archive.writeUInt32LE((mode << 16) >>> 0, centralOffset(archive) + 38);
    await assert.rejects(readStaticArchive(archive), /symlinks|special|Executable/);
  });
}

test("rejects duplicate and case-conflicting paths", async () => {
  await assert.rejects(
    readStaticArchive(
      await makeZip([
        ["a.txt", "a"],
        ["a.txt", "b"],
      ]),
    ),
    /Duplicate/,
  );
  await assert.rejects(
    readStaticArchive(
      await makeZip([
        ["A.txt", "a"],
        ["a.txt", "b"],
      ]),
    ),
    /case-conflicting/,
  );
});

test("rejects a file used as another entry's directory", async () => {
  await assert.rejects(
    readStaticArchive(
      await makeZip([
        ["dir", "a"],
        ["dir/index.html", "b"],
      ]),
    ),
    /parent directory/,
  );
});

test("rejects encrypted archives", async () => {
  const archive = await makeZip([["good.txt", "data"]]);
  archive.writeUInt16LE(archive.readUInt16LE(centralOffset(archive) + 8) | 1, centralOffset(archive) + 8);
  await assert.rejects(readStaticArchive(archive), /Encrypted/);
});

test("bounds compressed, declared unpacked, and file sizes", async () => {
  const archive = await makeZip([["good.txt", Buffer.alloc(4096)]]);
  await assert.rejects(readStaticArchive(archive, { limits: { compressedBytes: 1 } }), /compressed size/);
  await assert.rejects(readStaticArchive(archive, { limits: { unpackedBytes: 1024 } }), /unpacked size/);
  await assert.rejects(readStaticArchive(archive, { limits: { fileBytes: 1024 } }), /file size/);
});

test("rejects forged metadata when streamed data is larger", async () => {
  const archive = await makeZip([["good.txt", Buffer.alloc(4096)]]);
  archive.writeUInt32LE(1, centralOffset(archive) + 24);
  await assert.rejects(readStaticArchive(archive));
});

test("limits entry counts and rejects empty archives", async () => {
  await assert.rejects(
    readStaticArchive(
      await makeZip([
        ["a.txt", "a"],
        ["b.txt", "b"],
      ]),
      { limits: { entries: 1 } },
    ),
    /entry count/,
  );
  await assert.rejects(readStaticArchive(await makeZip([])), /no static files/);
});

test("requires exactly the expected JSON files for data publication", async () => {
  const archive = await makeZip([
    ["countries.json", "{}"],
    ["products.json", "[]"],
  ]);
  assert.equal(
    (await readStaticArchive(archive, { allowedPaths: ["countries.json", "products.json"], jsonOnly: true })).size,
    2,
  );
  await assert.rejects(readStaticArchive(archive, { allowedPaths: ["countries.json"], jsonOnly: true }), /Unexpected/);
  await assert.rejects(
    readStaticArchive(archive, { allowedPaths: ["countries.json", "products.json", "missing.json"], jsonOnly: true }),
    /missing/,
  );
  await assert.rejects(
    readStaticArchive(await makeZip([["countries.json", "invalid-data"]]), {
      allowedPaths: ["countries.json"],
      jsonOnly: true,
    }),
    /invalid JSON/,
  );
});

export { makeZip };

test("trusted namespace patterns admit site assets and validate JSON reports", async () => {
  const options = {
    allowedPattern: /^(?:data[/](?:index[.]json|(?:canary|prod)[/]report-[0-9-]+[.]json)|site[/].+)$/,
    jsonPathPrefix: "data/",
  };
  const files = await readStaticArchive(
    await makeZip([
      ["data/index.json", "{}"],
      ["site/index.html", "<h1>Site</h1>"],
    ]),
    options,
  );
  assert.equal(files.size, 2);
  await assert.rejects(readStaticArchive(await makeZip([["scripts/run.mjs", "code"]]), options), /pattern/);
  await assert.rejects(readStaticArchive(await makeZip([["data/index.json", "not JSON"]]), options), /invalid JSON/);
});
