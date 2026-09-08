/**
 * Copies MapLibre's worker into public/ so it can be served as a plain file.
 *
 * MapLibre v6 is ESM only and parses vector tiles in a Web Worker that imports
 * a sibling chunk. Next.js emits the worker through `new URL(..., import.meta.url)`
 * without rewriting that sibling import, so the worker 404s on its first
 * import and dies. The failure is close to silent: the Worker constructor
 * succeeds, the error arrives later with an empty message, and MapLibre does
 * not forward it to map.on("error"). Raster sources keep working because they
 * are fetched on the main thread, so the map looks alive while every vector
 * tile silently never loads.
 *
 * Serving both files ourselves sidesteps the bundler entirely. Both are needed:
 * the worker resolves its sibling by relative path, so they must land together.
 */

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const publicDir = path.join(import.meta.dirname, "..", "public");

mkdirSync(publicDir, { recursive: true });

for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(publicDir, file));
  console.log(`copied ${file} -> public/`);
}
