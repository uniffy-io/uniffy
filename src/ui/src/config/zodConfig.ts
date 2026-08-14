import { z } from "zod";

// Zod 4 JIT-compiles validators with `new Function()` and probes eval support
// at runtime. Both trigger CSP violations under our `script-src 'self'` policy.
// Disable JIT before any schema is constructed so zod stays on the interpreted
// path. Schemas capture this flag at construction time, which is why this
// module must be imported before anything that builds a zod schema.
z.config({ jitless: true });
