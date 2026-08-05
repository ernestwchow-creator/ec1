// Chord parsing, transposition and chart detection. This file is served to the
// browser as-is (see the /transpose.js route) so the preview and the server
// stay on one implementation — keep it dependency-free and ES5-flavoured.

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

function noteToIndex(note) {
  const n = String(note).replace('♯', '#').replace('♭', 'b');
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

// "No chord" marker — contains a capital C but must never be transposed.
const NO_CHORD = /^\(?N\.?C\.?\)?$/i;

function transposeToken(token, semitones, useFlats) {
  if (NO_CHORD.test(token.trim())) return token;

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

// Splits on whitespace AND on bar separators, keeping the delimiters, so that
// unspaced splits like "Bb7|A7" transpose on both sides of the bar.
function splitCell(text) {
  return String(text).split(/(\s+|\|)/);
}

function transposeCellText(text, semitones, useFlats) {
  if (!text || !text.trim()) return text;
  return splitCell(text).map(part => {
    if (/^\s*$/.test(part) || part === '|') return part;
    return transposeToken(part, semitones, useFlats);
  }).join('');
}

// Punctuation that can wrap a chord without changing what it is. The slash is
// deliberately NOT stripped — it separates a bass note and is parsed properly.
const WRAPPER_CHARS = /[|:()[\].,!?\\<>*]/g;

// Chord quality suffixes seen across both collections: m/min/-, maj/Δ/∆,
// aug/+, dim/º/°, ø/Ø, sus, add, extensions and altered tensions.
const QUALITY = /^(?:m(?:aj)?|M(?:aj)?|min|aug|dim|sus[24]?|add|dom|[Δ∆]|[øØ]|[°º]|\+|-)?(?:6|7|9|11|13)?(?:[#b♯♭]?\d+)*(?:\/\d+)?$/;

function isChordToken(token) {
  const cleaned = String(token).replace(WRAPPER_CHARS, '').trim();
  if (!cleaned) return false;
  if (/^x\d+$/i.test(cleaned)) return false;
  if (NO_CHORD.test(cleaned)) return false;
  if (/^\d+$/.test(cleaned)) return false;

  const match = cleaned.match(/^([A-G])([#b♯♭]?)(.*)/);
  if (!match) return false;

  const quality = match[3].replace(/\/[A-G][#b♯♭]?$/, '');
  if (!quality) return true;

  return QUALITY.test(quality);
}

// Tokens that carry structure rather than harmony: bar lines, repeat signs,
// volta numbers ("1:", "2."), repeat counts ("x3") and no-chord marks.
function isStructuralToken(t) {
  return /^[|:]+$/.test(t) || /^x\d+$/i.test(t) || /^:\|/.test(t) ||
    /^\|\|:/.test(t) || /^\d+[:.]?$/.test(t) || NO_CHORD.test(t);
}

function cellContainsChords(text) {
  if (!text || text.length > 120) return false;
  const tokens = splitCell(text).map(t => t.trim())
    .filter(t => t && t !== '|' && !isStructuralToken(t));
  if (tokens.length === 0) return false;
  const chordCount = tokens.filter(isChordToken).length;
  return chordCount > 0 && chordCount >= tokens.length * 0.4;
}

function isChordTable(tableData) {
  let chordCellCount = 0;
  let totalCheckCells = 0;

  for (const row of tableData) {
    for (let c = 1; c < row.length; c++) {
      const text = String(row[c] || '').trim();
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
      const text = String(row[c] || '').trim();
      if (!text) continue;
      for (const t of text.split(/\s+/)) {
        const cleaned = t.replace(WRAPPER_CHARS, '').replace(/\//g, '').trim();
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

// Whether column 0 holds section labels (and must not be transposed) rather
// than chords. Two chart styles exist side by side: "[Verse]"-style labels or
// bare A/B/C form letters, versus charts whose first column is simply the
// first bar of each line.
function detectLabelColumn(tableData) {
  const cells = tableData
    .map(row => String(row[0] || '').trim())
    .filter(Boolean);
  if (!cells.length) return false;

  const nonChord = cells.filter(c => !cellContainsChords(c)).length;
  if (nonChord >= cells.length * 0.5) return true;

  // Bare letters are ambiguous: "A" is both a chord and a section name. Treat
  // them as labels only when the distinct letters form a prefix of A,B,C,...
  // (classic song-form lettering); a first column of real one-chord bars in
  // some key almost never spells exactly A,B,C from the top.
  if (cells.every(c => /^[A-G]$/.test(c))) {
    const distinct = [...new Set(cells)].sort();
    // A single repeated letter is far likelier a chord (every line starting on
    // the tonic) than a form label — song forms need at least two sections.
    return distinct.length >= 2 &&
      distinct.every((letter, i) => letter === String.fromCharCode(65 + i));
  }

  return false;
}

function detectKeyFromChart(tableData) {
  const startCol = detectLabelColumn(tableData) ? 1 : 0;
  for (const row of tableData) {
    for (let c = startCol; c < row.length; c++) {
      const text = String(row[c] || '').trim();
      if (!text) continue;
      for (const t of splitCell(text)) {
        const cleaned = t.replace(WRAPPER_CHARS, '').trim();
        if (!cleaned || isStructuralToken(cleaned) || !isChordToken(cleaned)) continue;
        const match = cleaned.match(/^([A-G][#b♯♭]?)/);
        if (match) return match[1];
      }
    }
  }
  return 'C';
}

// One "chart" can be split across several consecutive tables (intro / body /
// outro fragments). Fragments share the chart's key, whereas separate charts
// in one document are almost always different keys (an original plus
// already-transposed copies) — so consecutive chord tables in the same key are
// grouped into a single chart with parts.
function buildChartGroups(tableDatas) {
  const groups = [];
  let current = null;

  tableDatas.forEach((data, i) => {
    const key = detectKeyFromChart(data);
    const pitch = noteToIndex(key);
    const part = { data, hasLabelColumn: detectLabelColumn(data), chordTableIndex: i };

    if (current && current.pitch === pitch) {
      current.parts.push(part);
    } else {
      current = { pitch, detectedKey: key, parts: [part] };
      groups.push(current);
    }
  });

  return groups;
}

// Parses a chart pasted as plain text. Tabs (what a Docs/Sheets/Excel table
// gives you on copy) take priority; then pipe-delimited markdown-style rows;
// then runs of two or more spaces. Blank lines split the paste into parts.
function parsePastedChart(text) {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n\s*\n+/)
    .map(b => b.replace(/^\n+|\n+$/g, ''))
    .filter(b => b.trim());

  const parts = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim());
    if (!lines.length) continue;
    const useTabs = lines.some(l => l.includes('\t'));

    const rows = lines.map(line => {
      if (useTabs) return line.split('\t').map(s => s.trim());
      if (/^\s*\|.*\|\s*$/.test(line)) {
        return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '')
          .split('|').map(s => s.trim());
      }
      return line.trim().split(/\s{2,}/).map(s => s.trim());
    }).filter(cells =>
      // Drop markdown alignment rows (| :-: | --- |) and all-empty rows.
      !cells.every(c => !c || /^:?-+:?$/.test(c))
    );

    if (rows.length) parts.push(rows);
  }
  return parts;
}

// Which spelling a key is conventionally written in. Db, Eb, F, Ab and Bb take
// flats; the rest take sharps. F# and Gb are genuinely ambiguous — F# is the
// commoner choice in guitar-led material, so it falls to the sharp side.
const FLAT_PITCH_CLASSES = new Set([1, 3, 5, 8, 10]);

function preferFlatsFor(note) {
  const idx = noteToIndex(note);
  if (idx === -1) return false;
  return FLAT_PITCH_CLASSES.has(idx);
}

function preferFlatsForKeyShift(originalKey, semitones) {
  const idx = noteToIndex(originalKey);
  if (idx === -1) return false;
  return FLAT_PITCH_CLASSES.has(((idx + semitones) % 12 + 12) % 12);
}

const api = {
  NOTES_SHARP, NOTES_FLAT,
  noteToIndex, transposeNote, transposeToken, transposeCellText,
  isChordToken, cellContainsChords, isChordTable, isRomanNumeralTable,
  detectLabelColumn, detectKeyFromChart, buildChartGroups, parsePastedChart,
  preferFlatsFor, preferFlatsForKeyShift
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  Object.assign(window, api);
}
