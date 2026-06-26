#!/usr/bin/env node
import { main } from './main.js';

// `new Date()` lives ONLY in the bin runtime entry — never in the library/test path.
// A `.catch` is mandatory here: without it a rejected main() would terminate Node with
// exit 1 (unhandled rejection), masquerading a tool-failure as a code-violation (block).
// The frozen exit contract requires tool-errors to surface as exit 2.
main(process.argv.slice(2), new Date().toISOString())
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`tool-error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  });
