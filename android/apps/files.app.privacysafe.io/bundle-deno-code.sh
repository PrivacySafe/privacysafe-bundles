#!/bin/bash
# Bundles the Deno service component into app/storageDenoServices.js.
# Runs after the GUI build (see "build" in package.json), which creates app/.

set -euo pipefail

OUT_FILE="app/storageDenoServices.js"

mkdir -p "$(dirname "$OUT_FILE")"

# The platform runs the component without access to environment variables.
# Code that reads Deno.env (e.g. bundled npm polyfills) would throw, so reads
# are answered with undefined. The current bundle does not read Deno.env; the
# stub only keeps future dependencies from breaking the start of the service.
cat > "$OUT_FILE" <<'EOF'
Deno.env = {
  get: function() {
    return undefined;
  }
}
EOF

esbuild "src_deno/index.ts" --bundle --platform=node --format=esm >> "$OUT_FILE"
