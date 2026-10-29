import { useEffect, useState } from 'react';
import { Globe, Github, ArrowUpRight, Youtube, HelpCircle } from 'lucide-react';
import { Page, Section, Card } from '../components/common';
import { replayOnboarding, TUTORIAL_URL } from '../utils/guide';

const KRYPT_URL = 'https://krypt.cc';
const TOOLS_URL = 'https://krypt.cc/tools';
const DISCORD_URL = 'https://discord.gg/muzFKR657F';
const OPENCUT_URL = 'https://github.com/OpenCut-app/OpenCut';

const SUITE = [
  { name: 'Krypt Macro', desc: 'Record, edit, and replay mouse + keyboard macros.' },
  { name: 'Krypt Shot', desc: 'A ShareX-style screenshot & screen-recording tool.' },
  { name: 'Krypt Clicker', desc: 'A precise, no-bloat auto clicker.' },
  { name: 'Krypt Cleaner', desc: 'A free CCleaner alternative + SSD-aware optimizer.' },
];

export function AboutPage() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.krypt.app.version().then(setVersion);
  }, []);

  return (
    <Page title="About" subtitle="Free. No ads. No telemetry. No bullshit.">
      <Section>
        <Card>
          <div className="flex items-center gap-4">
            <img
              src="./krypt.png"
              alt=""
              className="h-14 w-14 rounded-xl drop-shadow-[0_0_6px_rgba(168,85,247,0.55)]"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
            <div>
              <div className="text-2xl font-bold">
                <span className="text-krypt-gradient">Krypt</span> <span className="text-white">Editor</span>
              </div>
              <div className="text-sm text-krypt-muted mt-0.5">
                A free, open-source CapCut alternative — cut, trim, and compose on a timeline. {version && `v${version}`}
              </div>
            </div>
          </div>
          <p className="mt-5 text-sm text-krypt-muted leading-relaxed">
            Krypt Editor is a desktop video editor built on{' '}
            <button
              onClick={() => window.krypt.app.openExternal(OPENCUT_URL)}
              className="text-krypt-purple/90 hover:text-krypt-purple underline-offset-2 hover:underline"
            >
              OpenCut
            </button>{' '}
            (MIT). Everything runs on your machine — no accounts, no tracking, no watermarks. Free and
            open-source, like the rest of the suite.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <LinkButton onClick={() => window.krypt.app.openExternal(KRYPT_URL)} icon={Globe}>
              krypt.cc
            </LinkButton>
            <LinkButton onClick={() => window.krypt.app.openExternal(DISCORD_URL)} icon={ArrowUpRight}>
              Join the Discord
            </LinkButton>
            <LinkButton onClick={() => window.krypt.app.openExternal('https://github.com/krypt-net')} icon={Github}>
              Source
            </LinkButton>
          </div>
        </Card>
      </Section>

      <Section title="Guide" description="New here? The tour takes a minute; the video shows a full edit.">
        <Card>
          <div className="flex flex-wrap gap-2">
            <LinkButton onClick={() => window.krypt.app.openExternal(TUTORIAL_URL)} icon={Youtube}>
              Watch the video tutorial
            </LinkButton>
            <LinkButton onClick={replayOnboarding} icon={HelpCircle}>
              Replay the getting-started guide
            </LinkButton>
          </div>
        </Card>
      </Section>

      <Section title="More free Krypt tools">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {SUITE.map((t) => (
            <button
              key={t.name}
              onClick={() => window.krypt.app.openExternal(TOOLS_URL)}
              className="group text-left rounded-2xl border border-white/10 bg-krypt-panel/80 backdrop-blur-sm p-4 transition hover:border-krypt-purple/40 hover:shadow-krypt-glow"
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{t.name}</div>
                <ArrowUpRight className="h-4 w-4 text-krypt-muted group-hover:text-krypt-purple transition" />
              </div>
              <div className="text-xs text-krypt-muted mt-1">{t.desc}</div>
            </button>
          ))}
        </div>
      </Section>
    </Page>
  );
}

function LinkButton({ onClick, icon: Icon, children }: { onClick: () => void; icon: typeof Globe; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/90 transition hover:bg-white/10 hover:border-white/20"
    >
      <Icon className="h-4 w-4 text-krypt-purple" />
      {children}
    </button>
  );
}
