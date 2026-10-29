import RPC from 'discord-rpc';
import { resolveClientContext, isDebug } from './identity';

const ctx = resolveClientContext();

const DEFAULT_BUTTONS: Array<{ label: string; url: string }> = [
  { label: 'Free Tools', url: ctx.toolsUrl },
  { label: 'Krypt.cc', url: ctx.discordUrl },
];

let client: RPC.Client | null = null;
let connected = false;
let desired = false;
let last: { state: string; details: string } | null = null;
let startedAt = Date.now();

export async function startDiscordRpc(): Promise<void> {
  if (!ctx.intact && !isDebug()) return;
  desired = true;
  if (connected) return;
  try {
    client = new RPC.Client({ transport: 'ipc' });
    client.on('ready', () => {
      connected = true;
      startedAt = Date.now();
      pushActivity();
    });
    client.on('disconnected', () => {
      connected = false;
    });
    await client.login({ clientId: ctx.clientId });
  } catch (err) {
    console.warn('[presence] login skipped:', (err as Error)?.message);
    connected = false;
  }
}

export function stopDiscordRpc(): void {
  desired = false;
  try {
    client?.destroy();
  } catch {
  }
  client = null;
  connected = false;
  last = null;
}

export function setActivity(details: string, state: string): void {
  last = { details, state };
  pushActivity();
}

function pushActivity(): void {
  if (!connected || !client || !desired) return;
  const payload = last ?? { details: 'Idle', state: 'Editing video' };
  client
    .setActivity({
      details: payload.details,
      state: payload.state,
      largeImageKey: 'krypt',
      largeImageText: ctx.productName,
      startTimestamp: startedAt,
      instance: false,
      buttons: DEFAULT_BUTTONS,
    })
    .catch(() => {
    });
}
