const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

function noteToIndex(note) {
  const n = note.replace('♯', '#').replace('♭', 'b');
  let i = NOTES_SHARP.indexOf(n);
  if (i === -1) i = NOTES_FLAT.indexOf(n);
  return i;
}

function transposeNote(note, semitones, useFlats) {
  const idx = noteToIndex(note);
  if (idx === -1) return note;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return useFlats ? NOTES_FLAT[newIdx] : NOTES_SHARP[newIdx];
}

function transposeToken(token, semitones, useFlats) {
  const match = token.match(/^([^A-G]*)([A-G])([#b♯♭]?)(.*)/);
  if (!match) return token;

  const [, prefix, letter, accidental, rest] = match;
  const root = letter + accidental;
  const transposedRoot = transposeNote(root, semitones, useFlats);

  const bassMatch = rest.match(/^(.*)\/([A-G])([#b♯♭]?)$/);
  if (bassMatch) {
    const [, quality, bassLetter, bassAcc] = bassMatch;
    const bass = bassLetter + bassAcc;
    const transposedBass = transposeNote(bass, semitones, useFlats);
    return prefix + transposedRoot + quality + '/' + transposedBass;
  }

  return prefix + transposedRoot + rest;
}

function transposeCellText(text, semitones, useFlats) {
  if (!text || !text.trim()) return text;
  return text.split(/(\s+)/).map(part => {
    if (/^\s*$/.test(part)) return part;
    return transposeToken(part, semitones, useFlats);
  }).join('');
}

function isChordToken(token) {
  const cleaned = token.replace(/[|:()[\].,!?\\/]/g, '').trim();
  if (!cleaned) return false;
  if (/^x\d+$/i.test(cleaned)) return false;

  const match = cleaned.match(/^([A-G])([#b♯♭]?)(.*)/);
  if (!match) return false;

  const quality = match[3].replace(/\/[A-G][#b♯♭]?$/, '');
  if (!quality) return true;

  return /^(?:m(?:aj)?|M(?:aj)?|min|aug|dim|sus[24]?|add|dom|Δ|ø|°|\+|-)?(?:6|7|9|11|13)?(?:[#b♯♭]?\d+)*(?:\/\d+)?$/.test(quality);
}

function cellContainsChords(text) {
  if (!text || text.length > 100) return false;
  const tokens = text.split(/\s+/).filter(t =>
    t && !/^[|:]+$/.test(t) && !/^x\d+$/i.test(t) && !/^:\|/.test(t) && !/^\|\|:/.test(t)
  );
  if (tokens.length === 0) return false;
  const chordCount = tokens.filter(isChordToken).length;
  return chordCount > 0 && chordCount >= tokens.length * 0.4;
}

function isChordTable(tableData) {
  let chordCellCount = 0;
  let totalCheckCells = 0;

  for (const row of tableData) {
    for (let c = 1; c < row.length; c++) {
      const text = row[c].trim();
      if (!text) continue;
      totalCheckCells++;
      if (cellContainsChords(text)) chordCellCount++;
    }
  }

  return totalCheckCells > 0 && chordCellCount >= totalCheckCells * 0.3;
}

function isRomanNumeralTable(tableData) {
  let romanCount = 0;
  let totalTokens = 0;

  for (const row of tableData) {
    for (let c = 1; c < row.length; c++) {
      const text = row[c].trim();
      if (!text) continue;
      for (const t of text.split(/\s+/)) {
        const cleaned = t.replace(/[|:()[\].,!?\\/]/g, '').trim();
        if (!cleaned) continue;
        totalTokens++;
        if (/^[ivIV]+[0-9mMajdimaugsuΔø°]*$/.test(cleaned) && !/^[A-G]/.test(cleaned)) {
          romanCount++;
        }
      }
    }
  }

  return totalTokens > 0 && romanCount >= totalTokens * 0.3;
}

function detectKeyFromChart(tableData) {
  for (const row of tableData) {
    for (let c = 1; c < row.length; c++) {
      const text = row[c].trim();
      if (!text) continue;
      for (const t of text.split(/\s+/)) {
        const cleaned = t.replace(/[|:()[\].,!?\\/]/g, '').trim();
        const match = cleaned.match(/^([A-G][#b♯♭]?)/);
        if (match) return match[1];
      }
    }
  }
  return 'C';
}

function defaultUseFlats(note) {
  const n = note.replace('♯', '#').replace('♭', 'b');
  return FLAT_KEYS.has(n) || n.includes('b');
}

module.exports = {
  NOTES_SHARP, NOTES_FLAT,
  noteToIndex, transposeNote, transposeToken, transposeCellText,
  isChordToken, cellContainsChords, isChordTable, isRomanNumeralTable,
  detectKeyFromChart, defaultUseFlats
};
