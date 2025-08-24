export type JsonValue =
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonOptions = {
  [key: string]: JsonValue;
}

export interface XrayRule {
  type: 'field';
  ip?: string[];
  domain?: string[];
  outboundTag: string;
}

export interface XuiOptions {
  /** URL of the upstream 3x-ui endpoint (without trailing slash). */
  panelAddress: string;
  /** Username of the 3x-ui panel. */
  username: string;
  /** Password of the 3x-ui panel. */
  password: string;
  /** Intbound ID of the 3x-ui panel. */
  inboundIds: number[];
  /** Debug mode. */
  debug?: boolean;
}

export interface CreateServerProps {
  /** URL of the upstream 3x-ui endpoint (without trailing slash). */
  upstreamUrl: string;
  /** Secret path segment protecting this proxy, e.g. `abc123` → `/abc123/json/:id` */
  secretUrl: string;
  /** Directory with JSON rule presets (`RU.json`, `EU.json`, `BASE.json` …). */
  rulesDir: string;
  /** Directory with JSON overrides presets (`RU.json`, `EU.json`, `BASE.json` …). */
  overridesDir?: string;
  /** Inject direct‑route rules for the requester’s own country. */
  directSameCountry?: boolean;
  /** Enable Fastify logger. */
  logger?: boolean;
  /** Public Domain URL of the service. */
  publicURL?: string;
  /** Options for the 3x-ui panel. */
  xuiOptions?: XuiOptions;
  /**
   * Transform the JSON before sending it to the client.
   * @param json - The JSON object to transform.
   * @param iso - The ISO code of the country of the requester.
   * @param subId - The subscription ID of the requester.
   * @returns The transformed JSON object.
   */
  transform?: (json: JsonOptions, iso: string, subId: string) => Promise<JsonOptions> | JsonOptions;
}
