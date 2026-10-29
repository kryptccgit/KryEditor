import { Clapperboard, Settings, Info, Globe } from 'lucide-react';
import { cls } from '../utils/format';
import { useProjectStore } from '../editor/projectStore';
import { AiButton } from '../editor/AiPanel';

const KRYPT_URL = 'https://krypt.cc';
const DISCORD_URL = 'https://discord.gg/muzFKR657F';

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.21.375-.444.88-.608 1.28a18.27 18.27 0 0 0-5.487 0A12.6 12.6 0 0 0 9.18 3a19.74 19.74 0 0 0-4.435 1.37C1.93 8.59 1.165 12.69 1.548 16.73a19.93 19.93 0 0 0 6.073 3.07c.49-.668.927-1.377 1.302-2.122-.715-.27-1.4-.603-2.046-.99.172-.126.34-.257.502-.39a14.2 14.2 0 0 0 12.142 0c.164.137.332.268.502.39-.647.39-1.334.724-2.05.992.376.744.81 1.453 1.302 2.12a19.9 19.9 0 0 0 6.075-3.07c.45-4.69-.766-8.75-3.235-12.36ZM8.02 14.33c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.097 2.157 2.42 0 1.335-.956 2.42-2.157 2.42Zm7.96 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.333.955-2.42 2.157-2.42 1.21 0 2.176 1.097 2.157 2.42 0 1.335-.946 2.42-2.157 2.42Z" />
    </svg>
  );
}

export type RouteId = 'editor' | 'settings' | 'about';

export interface RouteSpec {
  id: RouteId;
  label: string;
  icon: typeof Clapperboard;
}

export const ROUTES: RouteSpec[] = [
  { id: 'editor', label: 'Editor', icon: Clapperboard },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'about', label: 'About', icon: Info },
];

export function TopNav({ current, onNavigate }: { current: RouteId; onNavigate: (next: RouteId) => void }) {
  const projectName = useProjectStore((s) => s.name);
  const dirty = useProjectStore((s) => s.dirty);
  return (
    <header className="relative z-50 flex items-center gap-4 border-b border-white/5 bg-krypt-void/70 px-4 py-2 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <img
          src="./krypt.png"
          alt=""
          className="h-7 w-7 rounded-md drop-shadow-[0_0_6px_rgba(168,85,247,0.55)]"
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
        />
        <div className="text-sm font-bold leading-none text-krypt-gradient">Krypt Editor</div>
      </div>

      {current === 'editor' && (
        <div className="flex items-center gap-1 border-l border-white/10 pl-3 text-xs text-krypt-muted" title={dirty ? 'Unsaved changes' : 'Saved'}>
          <span className="max-w-[180px] truncate">{projectName}</span>
          {dirty && <span className="text-krypt-pink">•</span>}
        </div>
      )}

      <nav className="flex items-center gap-1">
        {ROUTES.map((r) => {
          const Icon = r.icon;
          const active = current === r.id;
          return (
            <button
              key={r.id}
              onClick={() => onNavigate(r.id)}
              className={cls(
                'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition',
                active ? 'bg-white/10 text-white' : 'text-krypt-muted hover:bg-white/5 hover:text-white',
              )}
            >
              <Icon className={cls('h-4 w-4', active && 'text-krypt-purple')} />
              {r.label}
            </button>
          );
        })}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <AiButton />
        <button
          onClick={() => window.krypt.app.openExternal(KRYPT_URL)}
          className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-krypt-muted transition hover:border-krypt-purple/40 hover:bg-krypt-purple/10 hover:text-white"
        >
          <Globe className="h-3.5 w-3.5 transition group-hover:text-krypt-purple" />
          krypt.cc
        </button>
        <button
          onClick={() => window.krypt.app.openExternal(DISCORD_URL)}
          className="group flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-krypt-muted transition hover:border-[#5865F2]/50 hover:bg-[#5865F2]/15 hover:text-white"
        >
          <DiscordIcon className="h-3.5 w-3.5 transition group-hover:text-[#8b94f7]" />
          Discord
        </button>
      </div>
    </header>
  );
}
