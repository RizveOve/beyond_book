import { useState } from 'react';
import { ARView } from './components/ARView';
import { PreviewView } from './components/PreviewView';

type Screen = 'home' | 'ar' | 'preview';

const PRINT_URL = `${import.meta.env.BASE_URL}targets/heart-page.png`;

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');

  if (screen === 'ar') return <ARView onExit={() => setScreen('home')} />;
  if (screen === 'preview') return <PreviewView onExit={() => setScreen('home')} />;

  return (
    <main className="home">
      <div className="home__card">
        <p className="eyebrow">Chapter 4 · The Circulatory System</p>
        <h1>
          Beyond<span>Book</span>
        </h1>
        <p className="lede">
          Bring your textbook to life. Point your phone at the heart illustration and a beating 3D
          heart appears on the page.
        </p>

        <ol className="steps">
          <li>
            <a href={PRINT_URL} target="_blank" rel="noreferrer">
              Open the heart page
            </a>{' '}
            and print it (or show it on another screen).
          </li>
          <li>Tap <strong>Start AR</strong> and allow camera access.</li>
          <li>Hold your phone over the page — tap parts of the heart to learn about them.</li>
        </ol>

        <button className="primary" onClick={() => setScreen('ar')}>
          Start AR
        </button>
        <button className="secondary" onClick={() => setScreen('preview')}>
          View in 3D without camera
        </button>
      </div>
    </main>
  );
}
