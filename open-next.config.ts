import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * Defaults are enough here. Dock data is cached with `cf: { cacheTtl }` on the
 * outbound fetches rather than through Next's incremental cache, so there is no
 * R2 or KV cache binding to wire up, and every route is dynamic.
 */
export default defineCloudflareConfig();
