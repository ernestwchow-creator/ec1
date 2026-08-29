// Chord parsing, transposition and chart detection. This file is served to the
// browser as-is (see the /transpose.js route) so the preview and the server
// stay on one implementation — keep it dependency-free and ES5-flavoured.

const NOTES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// The four spellings that live outside both 12-note tables.
const ENHARMONIC = { 'Cb': 11, 'Fb': 4, 'E#': 5, 'B#': 0 };

function noteToIndex(note) {
  const n = String(note).replace('♯', '#').replace('♭', 'b');
  let i = NOTES_SHARP.indexOf(n);
  if (i === -1) i = NOTES_FLAT.indexOf(n);
  if (i === -1 && n in ENHARMONIC) i = ENHARMONIC[n];
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

// ---- Roman numeral charts ----
//
// A chart may be written key-relative: I IV V for major chords, i ii vi for
// minor, a b/# prefix bending the degree (bIII, bvii), qualities as suffixes
// (V7, IVΔ, iiiø, Vsus4, bIIImaj7), and slash basses that are themselves
// degrees (V/IV, ii/V, or a bare /V continuing the previous bar).
//
// Degrees follow the chart's mode. Verified against a chart written out both
// ways: in minor, VI means the natural-minor sixth (C in E minor), and the
// naturally-flat degrees accept a redundant explicit b (bIII ≡ III).
const MAJOR_DEGREE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11 };
const MINOR_DEGREE = { 1: 0, 2: 2, 3: 3, 4: 5, 5: 7, 6: 8, 7: 10 };
const NUMERALS = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };

const ROMAN_CORE = /^([#b♯♭]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)(.*)$/;

// Splits a token into wrapper punctuation and its core, so "(bVII)" or
// "||:i" parse and reassemble without losing the wrappers.
function splitWrappers(token) {
  const m = String(token).match(/^([^A-Za-z#♯♭]*)([\s\S]*?)([)\]>*.,!?:|]*)$/);
  return { open: m[1], core: m[2], close: m[3] };
}

// Parses one roman token core. Returns null when it is not one.
function parseRomanCore(core) {
  const m = core.match(ROMAN_CORE);
  if (!m) return null;
  const [, accidental, numeral, tail] = m;

  const lower = numeral === numeral.toLowerCase();

  let quality = tail;
  let bass = null;
  const bm = tail.match(/^(.*)\/([#b♯♭]?)(VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)$/);
  if (bm) {
    quality = bm[1];
    bass = { accidental: bm[2], numeral: bm[3] };
  }
  if (quality && !QUALITY.test(quality)) return null;

  return {
    accidental,
    degree: NUMERALS[numeral.toLowerCase()],
    lower,
    quality,
    bass
  };
}

function isRomanToken(token) {
  const { core } = splitWrappers(token);
  if (!core) return false;
  return !!parseRomanCore(core);
}

function cellContainsRoman(text) {
  if (!text || text.length > 120) return false;
  const tokens = splitCell(text).map(t => t.trim())
    .filter(t => t && t !== '|' && !isStructuralToken(t));
  if (tokens.length === 0) return false;
  const romanCount = tokens.filter(isRomanToken).length;
  return romanCount > 0 && romanCount >= tokens.length * 0.4;
}

function isRomanNumeralTable(tableData) {
  let romanCellCount = 0;
  let totalCheckCells = 0;

  for (const row of tableData) {
    for (let c = 1; c < row.length; c++) {
      const text = String(row[c] || '').trim();
      if (!text) continue;
      totalCheckCells++;
      if (cellContainsRoman(text)) romanCellCount++;
    }
  }

  return totalCheckCells > 0 && romanCellCount >= totalCheckCells * 0.3;
}

// Major unless the first tonic numeral in the chart is a lowercase i.
function detectRomanMode(tableData) {
  const startCol = detectLabelColumn(tableData, true) ? 1 : 0;
  for (const row of tableData) {
    for (let c = startCol; c < row.length; c++) {
      for (const t of splitCell(String(row[c] || ''))) {
        const token = t.trim();
        if (!token || token === '|' || isStructuralToken(token)) continue;
        const parsed = parseRomanCore(splitWrappers(token).core);
        if (parsed && parsed.degree === 1 && !parsed.accidental) {
          return parsed.lower ? 'minor' : 'major';
        }
      }
    }
  }
  return 'major';
}

function degreeToSemitones(degree, accidental, mode) {
  const minor = mode === 'minor';
  const base = (minor ? MINOR_DEGREE : MAJOR_DEGREE)[degree];
  const acc = accidental.replace('♯', '#').replace('♭', 'b');
  if (acc === '#') return base + 1;
  if (acc === 'b') {
    // In minor the 3rd/6th/7th are already flat; an explicit b is the same
    // degree written defensively, not a double flat.
    if (minor && MINOR_DEGREE[degree] !== MAJOR_DEGREE[degree]) return base;
    return base - 1;
  }
  return base;
}

// Realizes one roman token into a chord in the given key, e.g. in C major:
// ii7 -> Dm7, V/IV -> G/F, iiiø -> Eø, bVII -> Bb.
function realizeRomanToken(token, keyRoot, mode, useFlats) {
  const { open, core, close } = splitWrappers(token);
  const parsed = parseRomanCore(core);
  if (!parsed) return token;

  const keyIdx = noteToIndex(keyRoot);
  if (keyIdx === -1) return token;

  // A flattened degree spells flat and a raised one sharp, whatever the
  // chart-wide toggle says: bVII in C is Bb, never A#.
  const note = (offset, accidental) => {
    const idx = ((keyIdx + offset) % 12 + 12) % 12;
    const acc = accidental.replace('♯', '#').replace('♭', 'b');
    const flats = acc === 'b' ? true : acc === '#' ? false : useFlats;
    return flats ? NOTES_FLAT[idx] : NOTES_SHARP[idx];
  };

  const root = note(
    degreeToSemitones(parsed.degree, parsed.accidental, mode), parsed.accidental);
  // Lowercase means minor — unless the suffix already fixes the quality as
  // diminished or half-diminished, where an added m would be wrong (iiiø -> Eø).
  const minorMark = parsed.lower && !/^(ø|Ø|º|°|dim)/.test(parsed.quality) ? 'm' : '';

  let out = root + minorMark + parsed.quality;
  if (parsed.bass) {
    out += '/' + note(degreeToSemitones(
      NUMERALS[parsed.bass.numeral.toLowerCase()], parsed.bass.accidental, mode),
      parsed.bass.accidental);
  }
  return open + out + close;
}

function realizeRomanCellText(text, keyRoot, mode, useFlats) {
  if (!text || !text.trim()) return text;
  return splitCell(text).map(part => {
    if (/^\s*$/.test(part) || part === '|') return part;
    return realizeRomanToken(part, keyRoot, mode, useFlats);
  }).join('');
}

// Whether column 0 holds section labels (and must not be transposed) rather
// than chords. Two chart styles exist side by side: "[Verse]"-style labels or
// bare A/B/C form letters, versus charts whose first column is simply the
// first bar of each line.
function detectLabelColumn(tableData, roman) {
  const cells = tableData
    .map(row => String(row[0] || '').trim())
    .filter(Boolean);
  if (!cells.length) return false;

  const cellTest = roman ? cellContainsRoman : cellContainsChords;
  const nonChord = cells.filter(c => !cellTest(c)).length;
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
    const roman = isRomanNumeralTable(data);

    if (roman) {
      const part = { data, hasLabelColumn: detectLabelColumn(data, true), chordTableIndex: i };
      if (current && current.roman) {
        current.parts.push(part);
      } else {
        current = { roman: true, pitch: null, detectedKey: null, mode: null, parts: [part] };
        groups.push(current);
      }
      return;
    }

    const key = detectKeyFromChart(data);
    const pitch = noteToIndex(key);
    const part = { data, hasLabelColumn: detectLabelColumn(data), chordTableIndex: i };

    if (current && !current.roman && current.pitch === pitch) {
      current.parts.push(part);
    } else {
      current = { roman: false, pitch, detectedKey: key, parts: [part] };
      groups.push(current);
    }
  });

  for (const g of groups) {
    if (!g.roman) continue;
    // The chart's mode comes from its first tonic numeral; detectRomanMode
    // falls back to major, so any part reporting minor decides it.
    g.mode = g.parts.some(p => detectRomanMode(p.data) === 'minor') ? 'minor' : 'major';
  }

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
  isRomanToken, cellContainsRoman, detectRomanMode,
  realizeRomanToken, realizeRomanCellText,
  detectLabelColumn, detectKeyFromChart, buildChartGroups, parsePastedChart,
  preferFlatsFor, preferFlatsForKeyShift
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else if (typeof window !== 'undefined') {
  Object.assign(window, api);
}
