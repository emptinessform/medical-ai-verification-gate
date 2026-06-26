#!/usr/bin/env node
import { main } from './main.js';

// `new Date()` lives ONLY in the bin runtime entry — never in the library/test path.
main(process.argv.slice(2), new Date().toISOString()).then((code) => process.exit(code));
