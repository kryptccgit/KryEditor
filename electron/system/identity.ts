const K = 0x4b;

function dec(b64: string): string {
  try {
    const raw = Buffer.from(b64, 'base64');
    const out = Buffer.alloc(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ K;
    return out.toString('utf8');
  } catch {
    return '';
  }
}

const P = {
  name: 'ADkyOz9rDi8iPyQ5',
  cid: 'en9yfnh5eHJ6c3l4f395eH97fQ==',
  site: 'Iz8/OzhxZGQgOTI7P2UoKA==',
  tools: 'Iz8/OzhxZGQgOTI7P2UoKGQ/JCQnOA==',
  discord: 'Iz8/OzhxZGQvIjgoJDkvZSwsZCY+MQ0AGX1+fA0=',
};

export interface ClientContext {
  productName: string;
  clientId: string;
  siteUrl: string;
  toolsUrl: string;
  discordUrl: string;
  intact: boolean;
}

let cached: ClientContext | null = null;

export function isDebug(): boolean {
  return process.env.KRYPT_EDITOR_DEBUG === '1';
}

export function resolveClientContext(): ClientContext {
  if (cached) return cached;
  const productName = dec(P.name);
  const clientId = dec(P.cid);
  const ctx: ClientContext = {
    productName: productName || 'Video Editor',
    clientId,
    siteUrl: dec(P.site) || 'https://krypt.cc',
    toolsUrl: dec(P.tools) || 'https://krypt.cc/tools',
    discordUrl: dec(P.discord) || 'https://discord.gg/muzFKR657F',
    intact: Boolean(productName) && /^[0-9]{17,20}$/.test(clientId),
  };
  cached = ctx;
  return ctx;
}
