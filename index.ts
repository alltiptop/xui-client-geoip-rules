import Fastify from 'fastify';
import { readFileSync, readdirSync } from 'fs';
import { join, parse } from 'path';
import { lookup as ipLookup } from 'ip-location-api';
import countries from 'world-countries';

type PresetMap = Record<string, XrayRule[]>;

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
  const pattern = `regexp:.*\\.(?:${tlds.join('|')})$`;
  return { type: 'field', domain: [pattern], outboundTag: 'direct' };
}

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

export function createServer({
  upstreamUrl,
  secretUrl,
  rulesDir,
  directSameCountry = true,
  logger = true,
  publicURL,
}: CoreOptions) {
  const app = Fastify({ logger });
  const RULE_PRESETS: PresetMap = {};

  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.json'))) {
    const code = parse(file).name.toUpperCase();
    try {
      RULE_PRESETS[code] = JSON.parse(
        readFileSync(join(rulesDir, file), 'utf8'),
      );
      app.log.info(`Loaded rules for ${code}`);
    } catch (err) {
      app.log.error(`Failed to load ${file}: ${err}`);
    }
  }

  app.get<{ Params: { subscriptionId: string } }>(
    `/${secretUrl}/json/:subscriptionId`,
    async (req, reply) => {
      const { subscriptionId } = req.params;

      const ip = getClientIp(req.headers, req.ip);
      console.log(ip);
      let iso = '';
      try {
        iso = (await ipLookup(ip))?.country?.toUpperCase() || '';
      } catch (err) {
        req.log.warn(`GeoIP failed for ${ip}: ${err}`);
      }
      if (iso) USERS_COUNTRY_CACHE.set(subscriptionId, iso);
      if (!iso && USERS_COUNTRY_CACHE.has(subscriptionId)) iso = USERS_COUNTRY_CACHE.get(subscriptionId) || '';
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
        for (const [k, v] of res.headers.entries())
          if (!['content-length'].includes(k.toLowerCase()))
            reply.header(k, v);
      } catch (err) {
        req.log.error(`Fetch failed: ${err}`);
        return reply.code(502).send({ error: 'bad_gateway' });
      }

      const baseRules = RULE_PRESETS['BASE'] ?? [];
      const euRules = isEU ? RULE_PRESETS['EU'] ?? [] : [];
      const countryRules = RULE_PRESETS[iso] ?? RULE_PRESETS['DEFAULT'] ?? [];

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
        ...sameCountryRules,
        ...euRules,
        ...countryRules,
      ];

      const merged = {
        ...original,
        routing: {
          domainStrategy: 'IPIfNonMatch',
          rules,
        },
      };

      reply.send(JSON.stringify(merged, null, 2));
    },
  );

  app.setNotFoundHandler((_, reply) => reply.code(204).send());

  return app;
}
