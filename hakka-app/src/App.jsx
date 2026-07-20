import { useState } from 'react';
import { DIALECTS } from './data/curriculum';
import TopicBrowser from './components/TopicBrowser';
import DialogueMode from './components/DialogueMode';
import ScenarioMode from './components/ScenarioMode';
import FreeFormMode from './components/FreeFormMode';
import './App.css';

const MODES = {
  browse: { label: '學習 Browse', icon: '📖' },
  dialogue: { label: '對話 Dialogue', icon: '💬' },
  scenario: { label: '情境 Scenarios', icon: '🎯' },
  freeform: { label: '自由 Free Form', icon: '✍️' },
};

function App() {
  const [dialect, setDialect] = useState('sixian');
  const [toneDisplay, setToneDisplay] = useState('numeric');
  const [mode, setMode] = useState('browse');
  const [topic, setTopic] = useState(null);

  return (
    <div className="app">
      <header className="app-header">
        <h1>學客話 Learn Hakka</h1>
        <div className="settings">
          <div className="setting-group">
            <label>方言 Dialect:</label>
            <select value={dialect} onChange={e => setDialect(e.target.value)}>
              {Object.entries(DIALECTS).map(([key, d]) => (
                <option key={key} value={key}>{d.name} {d.english}</option>
              ))}
            </select>
          </div>
          <div className="setting-group">
            <label>聲調 Tones:</label>
            <button
              className={`tone-toggle ${toneDisplay === 'numeric' ? 'active' : ''}`}
              onClick={() => setToneDisplay('numeric')}
            >
              Numeric (sa1)
            </button>
            <button
              className={`tone-toggle ${toneDisplay === 'diacritic' ? 'active' : ''}`}
              onClick={() => setToneDisplay('diacritic')}
            >
              Diacritic (sā)
            </button>
          </div>
        </div>
      </header>

      <nav className="mode-nav">
        {Object.entries(MODES).map(([key, m]) => (
          <button
            key={key}
            className={`mode-btn ${mode === key ? 'active' : ''}`}
            onClick={() => { setMode(key); setTopic(null); }}
          >
            <span className="mode-icon">{m.icon}</span>
            <span className="mode-label">{m.label}</span>
          </button>
        ))}
      </nav>

      <main className="app-main">
        {mode === 'browse' && (
          <TopicBrowser
            dialect={dialect}
            toneDisplay={toneDisplay}
            topic={topic}
            setTopic={setTopic}
          />
        )}
        {mode === 'dialogue' && (
          <DialogueMode dialect={dialect} toneDisplay={toneDisplay} />
        )}
        {mode === 'scenario' && (
          <ScenarioMode dialect={dialect} toneDisplay={toneDisplay} />
        )}
        {mode === 'freeform' && (
          <FreeFormMode dialect={dialect} toneDisplay={toneDisplay} />
        )}
      </main>

      <footer className="app-footer">
        <p>VoxHakka TTS integration planned — currently text/romanization based</p>
      </footer>
    </div>
  );
}

export default App;
