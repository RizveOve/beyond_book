import { useState } from 'react';
import { HEART_PARTS } from '../content/heartParts';
import type { HeartExperience } from '../three/HeartExperience';

interface Props {
  heart: HeartExperience;
  selected: string | null;
  onClose: () => void;
}

const BPM_PRESETS = [
  { bpm: 72, label: 'Resting · 72 bpm' },
  { bpm: 130, label: 'Running · 130 bpm' },
  { bpm: 45, label: 'Sleeping · 45 bpm' },
];

/** Info card for the tapped part plus heartbeat / view controls. */
export function HeartHUD({ heart, selected, onClose }: Props) {
  const [beating, setBeating] = useState(heart.isBeating);
  const [presetIdx, setPresetIdx] = useState(() =>
    Math.max(0, BPM_PRESETS.findIndex((p) => p.bpm === heart.currentBpm)),
  );
  const part = selected ? HEART_PARTS[selected] : null;

  const toggleBeat = () => {
    heart.setBeating(!beating);
    setBeating(!beating);
  };

  const cycleBpm = () => {
    const next = (presetIdx + 1) % BPM_PRESETS.length;
    heart.setBpm(BPM_PRESETS[next].bpm);
    setPresetIdx(next);
  };

  return (
    <div className="hud">
      {part ? (
        <section className="info-card" aria-live="polite">
          <div className="info-card__head">
            <span className="swatch" style={{ background: part.color }} />
            <h2>{part.name}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          <p>{part.summary}</p>
          <p className="fact">
            <strong>Did you know?</strong> {part.fact}
          </p>
        </section>
      ) : (
        <p className="hint">Tap a part of the heart to learn about it · drag to rotate · pinch to zoom</p>
      )}

      <div className="controls">
        <button onClick={toggleBeat} aria-pressed={beating}>
          {beating ? '❚❚ Pause beat' : '▶ Play beat'}
        </button>
        <button onClick={cycleBpm} disabled={!beating}>
          ♥ {BPM_PRESETS[presetIdx].label}
        </button>
        <button onClick={() => heart.resetView()}>↺ Reset</button>
      </div>
    </div>
  );
}
