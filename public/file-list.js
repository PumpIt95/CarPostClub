export function snapshotSelectedFiles(fileList, predicate = () => true) {
  return Array.from(fileList || []).filter((file) => predicate(file));
}

export function clearFileInput(input) {
  if (input) input.value = "";
}

export function sameSelectedFile(left, right) {
  const leftName = normalizeFileName(left?.name);
  const rightName = normalizeFileName(right?.name);
  if (!leftName || leftName !== rightName) return false;

  const leftSize = Number(left?.size || 0);
  const rightSize = Number(right?.size || 0);
  return Boolean(leftSize && rightSize && leftSize === rightSize);
}

function normalizeFileName(value) {
  return String(value || "").trim().toLowerCase();
}
