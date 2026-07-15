import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function read(relativePath) {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("generated normalized album exports stay out of Git and Docker contexts", async () => {
  const gitignore = await read(".gitignore");
  const dockerignore = await read(".dockerignore");

  assert.match(gitignore, /^current-albums-normalized-\*\.json$/m);
  assert.match(dockerignore, /^current-albums-normalized-\*\.json$/m);
});

test("maintenance reads protected state as root and deployment archives use a private umask", async () => {
  const maintenance = await read("ops/carpostclub-maintenance.sh");
  const remoteDeploy = await read("ops/deploy-production-remote.sh");

  assert.match(
    maintenance,
    /docker exec --user 0:0 "\$\{container\}" node [^\n]+inventory_snapshot_retention/,
  );
  assert.match(
    maintenance,
    /docker exec --user 0:0 "\$\{container\}" node [^\n]+backup_state/,
  );
  assert.match(remoteDeploy, /^umask 077$/m);
});
