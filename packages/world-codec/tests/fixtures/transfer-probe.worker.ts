// Evaluation order matters: the patch module runs before the real world Worker entry.
import "./transfer-probe-patch.js";
import "../../src/world-worker.js";
