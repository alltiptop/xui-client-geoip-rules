import type { XuiOptions } from '../types.js';

interface XuiApiResponse<T> {
  success: boolean;
  msg?: string;
  obj: T;
}

interface XuiClient {
  id?: string;
  subId?: string;
  email?: string;
  comment?: string;
}

interface XuiInbound {
  id: number | string;
  settings?: string | { clients?: XuiClient[] };
}

const parseClients = (inbound: XuiInbound, debug: boolean): XuiClient[] => {
  if (!inbound.settings) return [];

  const settings =
    typeof inbound.settings === 'string'
      ? JSON.parse(inbound.settings)
      : inbound.settings;

  if (!settings || !Array.isArray(settings.clients)) {
    if (debug) {
      console.warn('[3x-ui debug] Inbound has no clients array:', inbound.id);
    }
    return [];
  }

  return settings.clients;
};

export const get3xui = async ({
  panelAddress,
  token,
  inboundIds,
  debug = false,
}: XuiOptions) => {
  const baseUrl = panelAddress.endsWith('/')
    ? panelAddress.slice(0, -1)
    : panelAddress;

  const fetchWithAuth = async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`3x-ui API error: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    return response.json() as Promise<T>;
  };

  const inboundIdSet = new Set(inboundIds.map((id) => String(id)));

  try {
    const data = await fetchWithAuth<XuiApiResponse<XuiInbound[]>>('/panel/api/inbounds/list');
    if (!data.success) {
      throw new Error(`3x-ui API error: ${data.msg || 'request failed'}`);
    }

    const inbounds = Array.isArray(data.obj) ? data.obj : [];
    if (debug) {
      console.log('[3x-ui debug] Inbounds fetched:', inbounds);
    }

    const allClients = inbounds
      .filter((inbound) => inboundIdSet.has(String(inbound.id)))
      .flatMap((inbound) => {
        try {
          return parseClients(inbound, debug);
        } catch (error) {
          if (debug) {
            console.warn('[3x-ui debug] Failed to parse inbound settings:', inbound.id, error);
          }
          return [];
        }
      });

    const getUserTags = (subscriptionId: string) => {
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
