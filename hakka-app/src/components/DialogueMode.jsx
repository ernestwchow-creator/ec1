import { useState } from 'react';
import { DIALOGUES, PHRASES } from '../data/curriculum';

function DialogueMode({ dialect, toneDisplay }) {
  const [selectedDialogue, setSelectedDialogue] = useState(null);
  const [revealedLines, setRevealedLines] = useState(0);

  if (!selectedDialogue) {
    return (
      <div>
        <h2 className="section-title">Dialogues</h2>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Step through conversations line by line. Practice each line aloud before revealing the next.
        </p>
        <div className="dialogue-selector">
          {DIALOGUES.map(d => (
            <div
              key={d.id}
              className="dialogue-card"
              onClick={() => { setSelectedDialogue(d); setRevealedLines(1); }}
            >
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{d.titleChinese}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{d.title}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const getRomanization = (line) => {
    if (line.dialectKey) {
      const phrase = PHRASES.find(p => p.id === line.dialectKey);
      if (phrase && phrase.dialects[dialect]) {
        return toneDisplay === 'numeric'
          ? phrase.dialects[dialect].pfs
          : phrase.dialects[dialect].tones;
      }
    }
    if (line.pfs && line.pfs[dialect]) {
      return line.pfs[dialect];
    }
    if (line.pfs) {
      const firstAvailable = Object.values(line.pfs)[0];
      return firstAvailable || '';
    }
    return '';
  };

  return (
    <div>
      <button className="back-btn" onClick={() => setSelectedDialogue(null)}>
        ← Back to Dialogues
      </button>
      <h2 className="section-title">
        {selectedDialogue.titleChinese} — {selectedDialogue.title}
      </h2>

      <div className="progress-bar">
        {selectedDialogue.lines.map((_, i) => (
          <div
            key={i}
            className={`progress-dot ${i < revealedLines ? 'completed' : ''} ${i === revealedLines - 1 ? 'current' : ''}`}
          />
        ))}
      </div>

      {selectedDialogue.lines.slice(0, revealedLines).map((line, i) => (
        <div key={i} className={`dialogue-line speaker-${line.speaker}`}>
          <span className="speaker-label">{line.speaker}</span>
          <div className="line-content">
            <div className="characters">{line.characters}</div>
            <div className="romanization">{getRomanization(line)}</div>
            <div className="english">{line.english}</div>
          </div>
        </div>
      ))}

      {revealedLines < selectedDialogue.lines.length ? (
        <button
          className="submit-btn"
          onClick={() => setRevealedLines(r => r + 1)}
          style={{ marginTop: '1rem' }}
        >
          Next Line →
        </button>
      ) : (
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: '0.5rem' }}>
            Dialogue complete!
          </p>
          <button
            className="submit-btn"
            onClick={() => setRevealedLines(1)}
          >
            Restart
          </button>
        </div>
      )}
    </div>
  );
}

export default DialogueMode;
