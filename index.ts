import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { readFileSync, readdirSync } from 'fs';
import { join, parse } from 'path';
import dotenv from 'dotenv';
import { lookup as ipLookup } from 'ip-location-api';
import countries from 'world-countries';

dotenv.config();

export interface CoreOptions {
  upstreamUrl: string;
  secretUrl: string;
  rulesDir: string;
  directSameCountry: boolean;
  logger?: boolean;
}

/**
 * Create server instance
 * @param upstreamUrl - URL of the upstream server
 * @param secretUrl - Secret URL for the server
 * @param rulesDir - Directory containing the rules
 * @param directSameCountry - If true, the server will direct the user to the same country as the user's IP
 * @param logger - Logger instance
 * @returns Fastify instance
 */
export function createServer({
  upstreamUrl,
  secretUrl,
  rulesDir,
  directSameCountry = true,
  logger = true,
}: CoreOptions): FastifyInstance {
  const app = Fastify({ logger });

  type PresetMap = Record<string, any>;
  const RULE_PRESETS: PresetMap = {};

  for (const file of readdirSync(rulesDir).filter((f) => f.endsWith('.json'))) {
    const code = parse(file).name.toUpperCase();
    try {
      RULE_PRESETS[code] = JSON.parse(
        readFileSync(join(rulesDir, file), 'utf8'),
      );
      app.log.info(`Loaded rules for ${code}`);
    } catch (e) {
      app.log.error(`Failed to load ${file}: ${e}`);
    }
  }

  app.get(`/${secretUrl}/json/:userId`, async (req, reply) => {
    const { userId } = req.params as { userId: string };

    /**
     * Client IP
     */
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim() || req.ip;

    const foundCountry = (await ipLookup(ip))?.country ?? '';
    const isEU = foundCountry.toUpperCase() === 'EU';
    const iso = foundCountry.toUpperCase();

    /**
     * Get original JSON from 3x-ui
     */
    const res = await fetch(`${upstreamUrl}/${userId}`);
    if (!res.ok) return reply.code(res.status).send({ error: 'upstream_error' });

    // Forward selected headers from the upstream response to the client
    const skipHeaders = new Set(['content-length', 'content-type']);
    for (const [key, value] of res.headers.entries()) {
      if (!skipHeaders.has(key.toLowerCase())) {
        reply.header(key, value);
      }
    }

    const original = await res.json();

    const foundCountryRules = RULE_PRESETS[iso] ?? RULE_PRESETS['DEFAULT'] ?? [];
    const euRules = isEU ? RULE_PRESETS['EU'] ?? [] : [];
    const baseRules = RULE_PRESETS['BASE'] ?? [];
    const localDomains = countries.find((c) => c.cca2 === iso)?.tld ?? [];
    const sameCountryRules = directSameCountry
      ? [
          localDomains ? {
            domain: localDomains.map((domain) => `regexp:.*\\.${domain}$`),
            outbounds: ['direct'],
            type: 'field',
          } : null,
          {
            ip: [`geoip:${iso}`],
            outbounds: ['direct'],
            type: 'field',
          },
        ].filter(Boolean)
      : [];

    const rules = [...baseRules, ...sameCountryRules, ...euRules, ...foundCountryRules];

    /**
     * Select/create rules
     */
    const preset = {
      routing: {
        domainStrategy: 'IPIfNonMatch',
        rules,
      },
    };

    /**
     * Merge and send
     */
    const merged = { ...original, ...preset };
    reply.send(JSON.stringify(merged, null, 2));
  });

  /**
   * Respond with 204 No Content for any unmatched route
   */
  app.setNotFoundHandler((_, reply) => {
    reply.code(204).send();
  });

  return app;
}
