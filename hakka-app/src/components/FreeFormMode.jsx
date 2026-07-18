import { useState } from 'react';
import { PHRASES } from '../data/curriculum';

function FreeFormMode({ dialect, toneDisplay }) {
  const [input, setInput] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [promptPhrase, setPromptPhrase] = useState(() => getRandomPhrase(dialect));

  function getRandomPhrase(d) {
    const available = PHRASES.filter(p => p.dialects[d]);
    return available[Math.floor(Math.random() * available.length)];
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const trimmed = input.trim();
    const target = promptPhrase.dialects[dialect];
    const targetRomanization = target.pfs.replace(/[0-9]/g, '').toLowerCase();
    const targetChars = promptPhrase.characters;

    let result;
    if (trimmed === targetChars) {
      result = { correct: true, message: 'Perfect! Exact character match.' };
    } else if (trimmed.toLowerCase() === target.pfs.toLowerCase()) {
      result = { correct: true, message: 'Perfect! Exact romanization match.' };
    } else if (trimmed.replace(/[0-9]/g, '').toLowerCase() === targetRomanization) {
      result = { correct: true, message: 'Correct consonants/vowels! Watch the tones.' };
    } else {
      result = {
        correct: false,
        message: 'Not quite. Here\'s what we were looking for:',
        expected: {
          characters: targetChars,
          pfs: target.pfs,
          tones: target.tones,
        },
      };
    }
    setFeedback(result);
  };

  const nextPrompt = () => {
    setPromptPhrase(getRandomPhrase(dialect));
    setInput('');
    setFeedback(null);
  };

  if (!promptPhrase) {
    return <p className="no-data">No phrases available for this dialect.</p>;
  }

  return (
    <div>
      <h2 className="section-title">Free Form Practice</h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Type the Hakka translation (characters or romanization) for the English prompt below.
      </p>

      <div className="scenario-prompt">
        <div className="english" style={{ fontSize: '1.2rem', color: 'var(--text)' }}>
          {promptPhrase.english}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <input
          type="text"
          className="freeform-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type in Hakka (characters or romanization)..."
          autoFocus
        />
        <button type="submit" className="submit-btn">Check</button>
      </form>

      {feedback && (
        <div className="feedback">
          <p style={{ color: feedback.correct ? '#28a745' : '#dc3545', fontWeight: 600 }}>
            {feedback.message}
          </p>
          {feedback.expected && (
            <div style={{ marginTop: '0.5rem' }}>
              <div className="characters">{feedback.expected.characters}</div>
              <div className="romanization">
                {toneDisplay === 'numeric' ? feedback.expected.pfs : feedback.expected.tones}
              </div>
            </div>
          )}
          <button
            className="submit-btn"
            onClick={nextPrompt}
            style={{ marginTop: '0.75rem' }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

export default FreeFormMode;
