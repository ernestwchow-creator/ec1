import { useState } from 'react';
import { SCENARIOS } from '../data/curriculum';

function ScenarioMode({ dialect, toneDisplay }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [score, setScore] = useState(0);
  const [completed, setCompleted] = useState(0);

  const scenario = SCENARIOS[currentIndex];

  const handleChoice = (choice, index) => {
    if (selected !== null) return;
    setSelected(index);
    if (choice.correct) {
      setScore(s => s + 1);
    }
    setCompleted(c => c + 1);
  };

  const nextScenario = () => {
    setSelected(null);
    setCurrentIndex(i => (i + 1) % SCENARIOS.length);
  };

  return (
    <div>
      <h2 className="section-title">Scenarios</h2>
      <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Choose the best response for each situation.
        Score: {score}/{completed}
      </p>

      <div className="scenario-prompt">
        <div className="characters">{scenario.prompt.characters}</div>
        <div className="english">{scenario.prompt.english}</div>
      </div>

      <div className="choices">
        {scenario.choices.map((choice, i) => {
          let className = 'choice-btn';
          if (selected !== null) {
            if (choice.correct) className += ' correct';
            else if (i === selected) className += ' incorrect';
          }
          return (
            <button
              key={i}
              className={className}
              onClick={() => handleChoice(choice, i)}
            >
              <div className="characters" style={{ fontSize: '1.2rem' }}>
                {choice.characters}
              </div>
              <div className="english">{choice.english}</div>
              {selected !== null && choice.correct && choice.pfs && (
                <div className="romanization" style={{ marginTop: '0.3rem' }}>
                  {choice.pfs[dialect] || Object.values(choice.pfs)[0]}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selected !== null && (
        <button
          className="submit-btn"
          onClick={nextScenario}
          style={{ marginTop: '1rem' }}
        >
          Next Scenario →
        </button>
      )}
    </div>
  );
}

export default ScenarioMode;
