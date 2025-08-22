import Fastify from 'fastify';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, parse } from 'path';
import { lookup as ipLookup } from 'ip-location-api';
import countries from 'world-countries';
import punycode from 'punycode';
import { XuiApi } from '3x-ui';

type PresetMap = Record<string, XrayRule[]>;

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

export const get3xui = async ({
  panelAddress,
  username,
  password,
  inboundIds,
  debug = false,
}: XuiOptions) => {
  try {
    const api = new XuiApi(
      `https://${username}:${password}@${panelAddress.split('://')[1]}`,
    );
    const inbound = await api.getInbounds();
    api.debug = debug;
    api.stdTTL = 30;

    const getUserTags = (subscriptionId: string) => {
      const allClients = inbound
        .filter((inbound) => inboundIds.includes(inbound.id))
        .flatMap((inbound) => inbound.settings.clients);
      const client = allClients.find(
        (client) => client.subId === subscriptionId,
      );

      const comment = (client?.comment as string | undefined) || '';

      // Regex: capture sequence after 'tags=' up to ;, newline, or another key=value segment
      const tagRegex = /tags=([\s\S]*?)(?=(?:\s+\S+=)|;|\n|$)/g;
      const out: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = tagRegex.exec(comment))) {
        const segment = match[1];
        segment
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .forEach((t) => out.push(t));
      }

      return Array.from(new Set(out));
    };

    return {
      getUserTags,
    };
  } catch (error) {
    console.error(error);
    return {
      getUserTags: () => [],
    };
  }
};

interface XrayRule {
  type: 'field';
  ip?: string[];
  domain?: string[];
  outboundTag: string;
}

const COUNTRY_TLDS = new Map<string, string[]>(
  countries.map((c) => [
    c.cca2.toUpperCase(),
    c.tld?.map((t) => t.replace(/^\./, '')) || [],
  ]),
);

/**
 * Cache for last country lookup to each user
 */
const USERS_COUNTRY_CACHE = new Map<string, string>();

function getClientIp(
  headers: Record<string, string | string[] | undefined>,
  ipFromFastify: string,
): string {
  const forwarded = headers['x-forwarded-for'] as string | undefined;
  return forwarded ? forwarded.split(',')[0].trim() : ipFromFastify;
}

function buildDomainRule(tlds: string[]): XrayRule | null {
  if (!tlds.length) return null;
  const pattern = `regexp:.*\\.(?:${tlds
    .map((domainSuffix) => punycode.toASCII(domainSuffix))
    .join('|')})$`;
  return { type: 'field', domain: [pattern], outboundTag: 'direct' };
}

export type JsonValue =
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonOptions = {
  [key: string]: JsonValue;
}

interface TagPreset {
  base: XrayRule[];
  default: XrayRule[];
  country: Record<string, XrayRule[]>;
}

export interface CoreOptions {
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
  /** Transform the JSON before sending it to the client. */
  transform?: (json: JsonOptions) => Promise<JsonOptions> | JsonOptions;
}

export async function createServer({
  upstreamUrl,
  secretUrl,
  rulesDir = 'rules',
  overridesDir = 'overrides',
  directSameCountry = true,
  logger = true,
  publicURL,
  xuiOptions,
  transform,
}: CoreOptions) {
  const app = Fastify({ logger });
  const RULE_PRESETS: PresetMap = {};
  const OVERRIDE_PRESETS: PresetMap = {};
  type ReversePreset = { exclude: Set<string>; rules: XrayRule[]; name: string };
  const REVERSE_PRESETS: ReversePreset[] = [];

  const TAGS_PRESETS: Record<string, TagPreset> = {};
  const { getUserTags } = xuiOptions
    ? await get3xui(xuiOptions)
    : {
      getUserTags: () => '',
    };

  // Includes support
  const includesDir = join(rulesDir, 'includes');
  const expandIncludes = (text: string, seen = new Set<string>()): string => {
    return text.replace(/"@include\s+([A-Za-z0-9._-]+)"/g, (_m, name: string) => {
      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      const fullPath = join(includesDir, fileName);
      try {
        if (seen.has(fullPath)) return '{}';
        if (!existsSync(fullPath)) return '{}';
        seen.add(fullPath);
        let content = readFileSync(fullPath, 'utf8');
        content = expandIncludes(content, seen);
        seen.delete(fullPath);
        return content.trim();
      } catch (err) {
        app.log.error(`Include failed for ${fullPath}: ${err}`);
        return '{}';
      }
    });
  };
  const flattenRuleArray = (arr: any[]): any[] => {
    const out: any[] = [];
    for (const item of arr) {
      if (Array.isArray(item)) {
        // Recursively flatten only when an array appears where a rule item is expected
        out.push(...flattenRuleArray(item));
      } else {
        out.push(item);
      }
    }
    return out;
  };
  const parseWithIncludes = (filePath: string, expectArray = false) => {
    const raw = readFileSync(filePath, 'utf8');
    const expanded = expandIncludes(raw);
    const parsed = JSON.parse(expanded);
    if (expectArray && Array.isArray(parsed)) return flattenRuleArray(parsed);
    return parsed;
  };

  if (existsSync(rulesDir)) {
    for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.json'))) {
      const baseName = parse(file).name;
      const full = join(rulesDir, file);
      try {
        if (baseName.startsWith('!')) {
          const list = baseName.slice(1).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
          const rules = parseWithIncludes(full, true) as XrayRule[];
          REVERSE_PRESETS.push({ exclude: new Set(list), rules, name: baseName });
          app.log.info(`Loaded reverse rules ${baseName}`);
        } else {
          const code = baseName.toUpperCase();
          RULE_PRESETS[code] = parseWithIncludes(full, true);
          app.log.info(`Loaded rules for ${code}`);
        }
      } catch (err) {
        app.log.error(`Failed to load ${file}: ${err}`);
      }
    }
  }

  if (existsSync(overridesDir)) {
    for (const file of readdirSync(overridesDir).filter((f) =>
      f.endsWith('.json'),
    )) {
      const code = parse(file).name.toUpperCase();
      try {
        OVERRIDE_PRESETS[code] = parseWithIncludes(join(overridesDir, file), false);
        app.log.info(`Loaded overrides for ${code}`);
      } catch (err) {
        app.log.error(`Failed to load ${file}: ${err}`);
      }
    }
  }

  const tagsDir = join(rulesDir, 'tags');
  if (existsSync(tagsDir)) {
    for (const dirent of readdirSync(tagsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      const tagName = dirent.name;
      const tagPath = join(tagsDir, tagName);
      const preset: TagPreset = { base: [], default: [], country: {} };

      const baseFile = join(tagPath, 'base.json');
      if (existsSync(baseFile)) {
        try {
          preset.base = parseWithIncludes(baseFile, true);
        } catch (err) {
          app.log.error(`Failed to load ${baseFile}: ${err}`);
        }
      }

      const defaultFile = join(tagPath, 'default.json');
      if (existsSync(defaultFile)) {
        try {
          preset.default = parseWithIncludes(defaultFile, true);
        } catch (err) {
          app.log.error(`Failed to load ${defaultFile}: ${err}`);
        }
      }

      for (const file of readdirSync(tagPath).filter(
        (f) => f.endsWith('.json') && !['base.json', 'default.json'].includes(f),
      )) {
        const code = parse(file).name.toUpperCase();
        try {
          preset.country[code] = parseWithIncludes(join(tagPath, file), true);
        } catch (err) {
          app.log.error(`Failed to load ${file}: ${err}`);
        }
      }

      TAGS_PRESETS[tagName] = preset;
      app.log.info(`Loaded tag preset ${tagName}`);
    }
  } else {
    app.log.info('No tags directory found – skipping tag presets');
  }

  app.get<{ Params: { subscriptionId: string } }>(
    `/${secretUrl}/json/:subscriptionId`,
    async (req, reply) => {
      const { subscriptionId } = req.params;
      const { tags } = req.query as { tags?: string[] | string };

      const tagsList =
        ((Array.isArray(tags) ? tags : (tags?.split(',') || [])).filter(Boolean) as string[]) ||
        [];

      const userTags = getUserTags(subscriptionId);

      const activeTags = [...tagsList, ...userTags];

      const ip = getClientIp(req.headers, req.ip);
      let iso = '';
      try {
        iso = (await ipLookup(ip))?.country?.toUpperCase() || '';
      } catch (err) {
        req.log.warn(`GeoIP failed for ${ip}: ${err}`);
      }
      if (iso) USERS_COUNTRY_CACHE.set(subscriptionId, iso);
      if (!iso && USERS_COUNTRY_CACHE.has(subscriptionId))
        iso = USERS_COUNTRY_CACHE.get(subscriptionId) || '';
      const isEU = iso === 'EU';

      let original: any;
      try {
        const res = await fetch(`${upstreamUrl}/${subscriptionId}`);
        if (!res.ok)
          return reply.code(res.status).send({ error: 'upstream_error' });
        original = await res.json();

        /**
         * Forward original headers (except content-length),
         * like "profile-update-interval" or "subscription-userinfo"
         * to keep original behavior
         */

        const hopByHop = new Set([
          'connection',
          'keep-alive',
          'proxy-authenticate',
          'proxy-authorization',
          'te',
          'trailer',
          'transfer-encoding',
          'upgrade',
        ]);
        for (const [k, v] of res.headers.entries()) {
          if (!hopByHop.has(k.toLowerCase())) reply.header(k, v);
        }
      } catch (err) {
        req.log.error(`Fetch failed: ${err}`);
        return reply.code(502).send({ error: 'bad_gateway' });
      }

      const baseRules = RULE_PRESETS['BASE'] ?? [];
      const euRules = isEU ? RULE_PRESETS['EU'] ?? [] : [];
      const countryRules = RULE_PRESETS[iso] ?? RULE_PRESETS['DEFAULT'] ?? [];
      const reverseRules = REVERSE_PRESETS
        .filter((p) => !p.exclude.has(iso))
        .flatMap((p) => p.rules);
      const tagsRules = activeTags
        .flatMap((tag) => {
          const preset = TAGS_PRESETS[tag];
          if (!preset) return [];
          const countryRules = preset.country[iso] ?? preset.default;
          return [...preset.base, ...countryRules];
        });

      const sameCountryRules: XrayRule[] = [];
      if (iso && directSameCountry) {
        const tldRule = buildDomainRule(COUNTRY_TLDS.get(iso) || []);
        if (tldRule) sameCountryRules.push(tldRule);
        sameCountryRules.push({
          type: 'field',
          ip: [`geoip:${iso.toLowerCase()}`],
          outboundTag: 'direct',
        });
      }

      /**
       * Direct rule for current service to avoid wrong routing on update
       */
      const directRules: XrayRule[] = publicURL
        ? [
            {
              type: 'field',
              domain: [`domain:${publicURL}`],
              outboundTag: 'direct',
            },
          ]
        : [];

      const rules: XrayRule[] = [
        ...directRules,
        ...baseRules,
        ...tagsRules,
        ...sameCountryRules,
        ...reverseRules,
        ...euRules,
        ...countryRules,
      ];

      const merged = {
        ...original,
        ...(OVERRIDE_PRESETS[iso] ?? OVERRIDE_PRESETS['DEFAULT'] ?? {}),
        remarks: `${original.remarks}${iso ? ` (${countries.find((c) => c.cca2 === iso)?.name.common})` : ''}`,
        routing: {
          domainStrategy: 'IPIfNonMatch',
          rules,
        },
      };

      if (transform) {
        try {
          const transformed = await transform(merged);
          reply.send(JSON.stringify(transformed, null, 2));
        } catch (err) {
          app.log.error(`Transform failed: ${err}`);
          reply.send(JSON.stringify(merged, null, 2));
        }
      }

      reply.send(JSON.stringify(merged, null, 2));
    },
  );

  app.setNotFoundHandler((_, reply) => reply.code(204).send());

  return app;
}
