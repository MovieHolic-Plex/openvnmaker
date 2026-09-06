import assert from "node:assert/strict";
import "./process-peer.js";

// Keep the actual peer's SQLite handle open until the parent kills the process.
const mode = process.argv[4];
process.prependListener("message", (message: unknown) => {
  const namespace = process.argv[3];
  switch (mode) {
    case "prepare":
    case "stop":
      if (message === `${mode}:${namespace}`) {
        assert.ok(process.send);
        process.send(`blocked:${namespace}`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      break;
    case "nonzero":
      if (message === `stop:${namespace}`) process.exitCode = 7;
      break;
    case "normal": break;
    default: assert.fail("PROCESS_TEST_PEER_MODE");
  }
});
