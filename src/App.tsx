import { useState } from 'react';
import { ARView } from './components/ARView';
import { PreviewView } from './components/PreviewView';
import { TARGETS } from './content/targets';

type Screen = { name: 'home' } | { name: 'ar' } | { name: 'preview'; target: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const home = () => setScreen({ name: 'home' });

  if (screen.name === 'ar') return <ARView onExit={home} />;
  if (screen.name === 'preview') return <PreviewView targetIndex={screen.target} onExit={home} />;

  return (
    <main className="home">
      <div className="home__card">
        <p className="eyebrow">Augmented-reality textbook</p>
        <h1>
          Beyond<span>Book</span>
        </h1>
        <p className="lede">
          Point your phone at a printed page and a detailed 3D model appears on it. Tap any part to
          learn what it does.
        </p>

        <ol className="steps">
          <li>Print a chapter page below (black &amp; white is fine) or show it on another screen.</li>
          <li>Tap <strong>Start AR</strong> and allow camera access.</li>
          <li>Hold your phone over the page. Move away and the model stays with you.</li>
        </ol>

        <button className="primary" onClick={() => setScreen({ name: 'ar' })}>
          Start AR
        </button>

        <h2 className="chapters__title">Chapters</h2>
        <ul className="chapters">
          {TARGETS.map((t, i) => (
            <li key={t.id} className="chapter-card">
              <img src={t.pageUrl} alt="" loading="lazy" />
              <div className="chapter-card__body">
                <span className="chapter-card__kicker">{t.chapter}</span>
                <strong>{t.title}</strong>
                <div className="chapter-card__actions">
                  <a href={t.pageUrl} target="_blank" rel="noreferrer">
                    Print page
                  </a>
                  <button onClick={() => setScreen({ name: 'preview', target: i })}>View in 3D</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
