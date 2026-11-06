import { useState } from 'react';
import type { ModelExperience } from '../three/ModelExperience';
import { CTPanel } from './CTPanel';

interface Props {
  model: ModelExperience;
  selected: string | null;
  onClose: () => void;
  /** Shown with the colour key, e.g. what the colour families mean. */
  colorNote?: string;
}

const BPM_PRESETS = [
  { bpm: 72, label: 'Resting · 72' },
  { bpm: 130, label: 'Running · 130' },
  { bpm: 45, label: 'Sleeping · 45' },
];

/** Info card for the tapped part plus the model's tool bar. */
export function ModelHUD({ model: heart, selected, onClose, colorNote }: Props) {
  const [beating, setBeating] = useState(heart.isBeating);
  const [labels, setLabels] = useState(heart.isLabelsOn);
  const [exploded, setExploded] = useState(heart.isExploded);
  const [spinning, setSpinning] = useState(heart.isAutoRotating);
  const [ctOn, setCtOn] = useState(heart.ct?.isEnabled ?? false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [presetIdx, setPresetIdx] = useState(() =>
    Math.max(0, BPM_PRESETS.findIndex((p) => p.bpm === heart.currentBpm)),
  );
  const part = selected ? heart.partInfo[selected] : null;

  const toggle = (value: boolean, apply: (v: boolean) => void, set: (v: boolean) => void) => {
    apply(!value);
    set(!value);
  };

  const cycleBpm = () => {
    const next = (presetIdx + 1) % BPM_PRESETS.length;
    heart.setBpm(BPM_PRESETS[next].bpm);
    setPresetIdx(next);
  };

  const reset = () => {
    heart.resetView();
    setExploded(false);
    setSpinning(false);
  };

  const toggleCT = () => {
    heart.ct?.setEnabled(!ctOn);
    setCtOn(!ctOn);
  };

  return (
    <>
    {ctOn && heart.ct && <CTPanel model={heart} />}
    <div className="hud">
      {keyOpen && heart.isColorCoded && (
        <section className="color-key" aria-label="Colour key">
          {colorNote && <p className="color-key__note">{colorNote}</p>}
          <ul>
            {heart.presentParts.map((p) => (
              <li key={p.key}>
                <button
                  className={p.key === selected ? 'is-active' : ''}
                  onClick={() => heart.select(p.key === selected ? null : p.key)}
                >
                  <span className="color-key__dot" style={{ background: p.color }} />
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
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
        !keyOpen && <p className="hint">Tap a part to learn about it · drag to turn · pinch to zoom</p>
      )}

      <div className="toolbar" role="toolbar" aria-label="Model tools">
        {heart.hasHeartbeat && (
          <>
            <button
              onClick={() => toggle(beating, (v) => heart.setBeating(v), setBeating)}
              aria-pressed={beating}
            >
              <span aria-hidden>{beating ? '❚❚' : '▶'}</span> Beat
            </button>
            <button onClick={cycleBpm} disabled={!beating} title="Change heart rate">
              <span aria-hidden>♥</span> {BPM_PRESETS[presetIdx].label}
            </button>
          </>
        )}
        <button
          onClick={() => toggle(labels, (v) => heart.setLabels(v), setLabels)}
          aria-pressed={labels}
        >
          <span aria-hidden>Aa</span> Labels
        </button>
        <button
          onClick={() => toggle(exploded, (v) => heart.setExploded(v), setExploded)}
          aria-pressed={exploded}
        >
          <span aria-hidden>✣</span> Explode
        </button>
        <button
          onClick={() => toggle(spinning, (v) => heart.setAutoRotate(v), setSpinning)}
          aria-pressed={spinning}
        >
          <span aria-hidden>⟳</span> Spin
        </button>
        <button onClick={() => heart.zoomBy(1 / 1.35)} aria-label="Zoom out">
          −
        </button>
        <button onClick={() => heart.zoomBy(1.35)} aria-label="Zoom in">
          +
        </button>
        {heart.isColorCoded && (
          <button onClick={() => setKeyOpen((k) => !k)} aria-pressed={keyOpen}>
            <span aria-hidden>●</span> Key
          </button>
        )}
        {heart.ct && (
          <button onClick={toggleCT} aria-pressed={ctOn}>
            <span aria-hidden>◎</span> CT scan
          </button>
        )}
        <button onClick={reset}>
          <span aria-hidden>↺</span> Reset
        </button>
      </div>
    </div>
    </>
  );
}
