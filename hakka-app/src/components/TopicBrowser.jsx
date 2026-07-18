import { TOPICS, PHRASES } from '../data/curriculum';

function TopicBrowser({ dialect, toneDisplay, topic, setTopic }) {
  if (!topic) {
    return (
      <div>
        <h2 className="section-title">Choose a Topic</h2>
        <div className="topic-grid">
          {Object.entries(TOPICS).map(([key, t]) => (
            <div key={key} className="topic-card" onClick={() => setTopic(key)}>
              <span className="topic-chinese">{t.name}</span>
              <span className="topic-english">{t.english}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const phrases = PHRASES.filter(p => p.topic === topic && p.dialects[dialect]);

  return (
    <div>
      <button className="back-btn" onClick={() => setTopic(null)}>
        ← Back to Topics
      </button>
      <h2 className="section-title">
        {TOPICS[topic].name} {TOPICS[topic].english}
      </h2>
      {phrases.length === 0 ? (
        <p className="no-data">
          No phrases available for this dialect yet. Try Sixian or Hailu.
        </p>
      ) : (
        phrases.map(phrase => {
          const dialectData = phrase.dialects[dialect];
          const romanization = toneDisplay === 'numeric'
            ? dialectData.pfs
            : dialectData.tones;
          return (
            <div key={phrase.id} className="card">
              <div className="characters">{phrase.characters}</div>
              <div className="romanization">{romanization}</div>
              <div className="english">{phrase.english}</div>
            </div>
          );
        })
      )}
    </div>
  );
}

export default TopicBrowser;
