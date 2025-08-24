import { XuiApi } from '3x-ui';

import type { XuiOptions } from '../types.js';

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
