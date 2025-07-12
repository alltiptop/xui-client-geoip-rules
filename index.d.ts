export interface CoreOptions {
  /** URL of the upstream 3x-ui endpoint (without trailing slash). */
  upstreamUrl: string;
  /** Secret path segment protecting this proxy, e.g. `abc123` → `/abc123/json/:id` */
  secretUrl: string;
  /** Directory with JSON rule presets (`RU.json`, `EU.json`, `BASE.json` …). */
  rulesDir: string;
  /** Inject direct‑route rules for the requester’s own country. */
  directSameCountry?: boolean;
  /** Enable Fastify logger. */
  logger?: boolean;
  /** Public Domain URL of the service. */
  publicURL?: string;
}
