import { useEffect, useState } from 'react';
import { FolderOpen, RotateCcw } from 'lucide-react';
import { Page, Section, Card, GhostButton } from '../components/common';
import { useApp } from '../state/AppStateProvider';
import { useToast } from '../state/ToastProvider';
import { useModal } from '../state/ModalProvider';
import { IS_MAC } from '../utils/format';
import { VoiceModelCard } from '../editor/VoiceModelCard';
import { SpeechModelCard } from '../editor/SpeechModelCard';

export function SettingsPage() {
  const { state, update } = useApp();
  const toast = useToast();
  const modal = useModal();
  const [userData, setUserData] = useState('');

  useEffect(() => {
    void window.krypt.app.getUserDataPath().then(setUserData);
  }, []);

  if (!state) return null;

  const pickFolder = async (): Promise<void> => {
    const dir = await window.krypt.app.pickDirectory();
    if (dir) void update({ workingDirectory: dir });
  };

  const resetAll = async (): Promise<void> => {
    const yes = await modal.confirm({
      title: 'Reset all settings?',
      message: 'The working folder and recent projects return to defaults.',
      confirmLabel: 'Reset',
      destructive: true,
    });
    if (!yes) return;
    await window.krypt.state.reset();
    toast.success('Settings reset to defaults');
  };

  const workingDir = state.workingDirectory || `${userData}${IS_MAC ? '/' : '\\'}Projects`;

  return (
    <Page title="Settings" subtitle="Working folder and app data.">
      <Section title="Working folder" description="Where media imports and exports default to.">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Folder</div>
              <div className="text-xs text-krypt-muted font-mono truncate mt-0.5">{workingDir}</div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {state.workingDirectory && (
                <GhostButton onClick={() => void update({ workingDirectory: null })}>Default</GhostButton>
              )}
              <GhostButton onClick={() => void pickFolder()}>
                <FolderOpen className="h-4 w-4" />
                Choose…
              </GhostButton>
            </div>
          </div>
        </Card>
      </Section>

      <Section title="Voice-over" description="The English text-to-speech voices (Kokoro). Downloaded once, then everything runs on this PC.">
        <Card>
          <VoiceModelCard />
        </Card>
      </Section>

      <Section title="Speech recognition" description="The Whisper model behind captions, Transcript, auto edit and Re-voice. Everything runs on this PC.">
        <Card>
          <SpeechModelCard />
        </Card>
      </Section>

      <Section
        title="Always on"
        description="Krypt Editor starts at login, stays in the tray when closed, and shows Discord Rich Presence while running."
      >
        <Card>
          <div className="text-xs text-krypt-muted">
            Closing the window keeps the app in the tray — use the tray icon's Quit to exit fully.
          </div>
        </Card>
      </Section>

      <Section title="Danger zone">
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Reset settings</div>
              <div className="text-xs text-krypt-muted mt-0.5">Return everything to defaults.</div>
            </div>
            <GhostButton destructive onClick={() => void resetAll()}>
              <RotateCcw className="h-4 w-4" />
              Reset
            </GhostButton>
          </div>
        </Card>
      </Section>
    </Page>
  );
}
