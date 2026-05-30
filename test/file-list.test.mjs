import assert from "node:assert/strict";
import test from "node:test";
import { clearFileInput, sameSelectedFile, snapshotSelectedFiles } from "../public/file-list.js";

test("snapshots a live FileList before the input is cleared", () => {
  const liveFileList = {
    files: [
      { name: "dash.jpg", type: "image/jpeg" },
      { name: "notes.txt", type: "text/plain" },
      { name: "trunk.heic", type: "" },
    ],
    [Symbol.iterator]() {
      return this.files[Symbol.iterator]();
    },
  };
  const input = {
    set value(nextValue) {
      if (nextValue === "") liveFileList.files = [];
    },
  };
  const isImageLike = (file) => file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);

  const selected = snapshotSelectedFiles(liveFileList, isImageLike);
  clearFileInput(input);

  assert.deepEqual(selected.map((file) => file.name), ["dash.jpg", "trunk.heic"]);
  assert.equal(Array.from(liveFileList).length, 0);
});

test("documents the regression: clearing first loses live FileList selections", () => {
  const liveFileList = {
    files: [{ name: "rear-seats.jpg", type: "image/jpeg" }],
    [Symbol.iterator]() {
      return this.files[Symbol.iterator]();
    },
  };
  const input = {
    set value(nextValue) {
      if (nextValue === "") liveFileList.files = [];
    },
  };

  clearFileInput(input);
  const selected = snapshotSelectedFiles(liveFileList);

  assert.equal(selected.length, 0);
});

test("does not treat same-name mobile photos as duplicates without a matching size", () => {
  assert.equal(
    sameSelectedFile(
      { name: "image.jpg", size: 321000 },
      { name: "image.jpg", size: 654000 },
    ),
    false,
  );
  assert.equal(
    sameSelectedFile(
      { name: "image.jpg", size: 321000 },
      { name: "image.jpg", size: 0 },
    ),
    false,
  );
  assert.equal(
    sameSelectedFile(
      { name: "image.jpg", size: 321000 },
      { name: "IMAGE.JPG", size: 321000 },
    ),
    true,
  );
});
