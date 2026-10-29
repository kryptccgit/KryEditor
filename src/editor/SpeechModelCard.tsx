import { useEffect, useState } from 'react';
import { accurateModelName, hasWebGpu, setSpeechAccuracy, speechAccuracy, type SpeechAccuracy } from './captions';

export function SpeechModelCard() {
  const [accuracy, setAccuracy] = useState<SpeechAccuracy>(speechAccuracy);
  const [gpu, setGpu] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void hasWebGpu().then((ok) => live && setGpu(ok));
    return () => {
      live = false;
    };
  }, []);
  const pick = (a: SpeechAccuracy): void => {
    setSpeechAccuracy(a);
    setAccuracy(a);
  };
  const OPTIONS: Array<{ value: SpeechAccuracy; label: string; hint: string; disabled?: boolean }> = [
    { value: 'fast', label: 'Fast', hint: 'Whisper base · ~300 MB · runs anywhere' },
    { value: 'accurate', label: 'Accurate', hint: `${accurateModelName()} · fewer missed words`, disabled: gpu === false },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => pick(o.value)}
            disabled={o.disabled}
            className={`rounded-lg border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
              accuracy === o.value && !o.disabled ? 'border-krypt-purple/60 bg-krypt-purple/20 text-white' : 'border-white/10 bg-white/[0.03] text-krypt-muted hover:text-white'
            }`}
          >
            <div className="text-sm font-semibold">{o.label}</div>
            <div className="text-[11px] opacity-80">{o.hint}</div>
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-krypt-muted">
        {gpu === null
          ? 'Checking your graphics card…'
          : gpu
            ? 'Transcription runs on your graphics card. Each file is transcribed once and remembered.'
            : 'No WebGPU graphics card found, so transcription runs on the CPU and only the fast model is offered.'}
      </p>
    </div>
  );
}
