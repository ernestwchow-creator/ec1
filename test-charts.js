// Fixtures taken verbatim from two real chart collections: Ernie's (section
// labels in column 0, Δ/ø/dim spellings, ||: repeats) and Rob's (no label
// column or bare A/B/C letters, -7 minors, º diminished, ∆ major-7, voltas,
// N.C., unspaced pipe splits, and single charts split across several tables).
const assert = require('assert');
const {
  transposeToken, transposeCellText, isChordToken, isChordTable,
  detectLabelColumn, detectKeyFromChart, buildChartGroups, parsePastedChart
} = require('./src/transpose');

// --- Rob's "You Don't Know Me" (key C, no label column) ---
const YOU_DONT_KNOW_ME = [
  ['C | G+', 'C | G-7 C7', 'F6', 'F#º', 'C | A7', 'D-7 | G7', 'E7 | A7', 'D-7 | G7'],
  ['C | G+', 'C | C7', 'F6', 'F#º', 'C | A7', 'D-7 | G7', 'C | F', 'G-7 | C7'],
  ['F | F#º', 'C∆ | A7', 'D-7 | G7', 'C∆ | E7', 'A-7', 'E-7 | A7', 'D7', 'G7'],
  ['C | G+', 'C | C7', 'F6', 'F#º', 'C | A7', 'D-7 | G7', 'C |Bb7 B', 'C | G7']
];

// --- Rob's "Is You Is" (bare-letter section labels, unspaced pipes) ---
const IS_YOU_IS_INTRO = [
  ['', 'Gm | F', 'Eb7 | D7', 'Gm | F', 'Eb7 | D7', 'C7', 'C7', 'F7', 'D7    :|']
];
const IS_YOU_IS_MAIN = [
  ['A', 'Gm | D7', 'Gm | D7', 'Gm Gm7 lick', 'Gm | (Db9)', 'C7', 'F7', 'Bb', '1: Eb7 |D 2: Bb7'],
  ['B', 'Eb6', 'Eº', 'Bb', 'Bb7', 'Eb6', 'Ebm', 'D7', 'Eb7|D7'],
  ['C', 'Gm | D7', 'Gm | D7', 'Gm', 'Gm | (Db9)', 'C7', 'F7', 'Bb7|A7', 'Ab7|G7'],
  ['', 'C7', 'F7', 'Bb', 'Eb7 | D7', '', '', '', '']
];

// --- Rob's "Come Fly With Me": ONE chart split across three tables ---
const COME_FLY_INTRO = [['C6', 'Ebº7', 'D-7', 'G+', '', '', '', '']];
const COME_FLY_MAIN = [
  ['C∆ | C6', 'E-7 | Ebº', 'D-7', 'G7', 'C∆ | C6', 'G-7 | C7', 'F6', 'Bb7'],
  ['C∆ | C6', '1:     F7', 'E7 | A7', 'D7 | G7', '', '', '', ''],
  ['2: F7 | G7', 'C6 | F', '<C6>', '', '', '', '', ''],
  ['Ab∆', 'Ab+', 'Db∆', 'Db6', 'Bb-7', 'Eb7', 'Ab6', '(Bb-7)'],
  ['Ab | Ab+', 'Ab6', 'G∆', 'G | G#º', 'A-7', 'D7', '<D-7>', 'N.C.'],
  ['*C∆ | C6', 'F7', 'Eø | Bb7', 'A7', 'D7', 'D-7 | G7', 'C6', '(D-7|G7)']
];
const COME_FLY_OUTRO = [
  ['*C∆ | C6', 'F7', 'Eø | Bb7', 'A7', 'D7', 'D7', 'D7| D-7', '<G7>'],
  ['C | F9', 'C | D-7', '11<C>', 'C∆', '', '', '', '']
];

// --- Ernie's "First Kiss": original in F and an already-transposed G copy ---
const FIRST_KISS_F = [
  ['[Intro]', '||: F6      Aaug', 'BbΔ   Gø', ':||', ''],
  ['[Verse]', '||: F6    Cm7', 'Gm7/D   Aaug', 'F6 G7', 'Gø C7.  :||']
];
const FIRST_KISS_G = [
  ['[Intro]', '||: G6      Baug', 'CΔ   Aø', ':||', ''],
  ['[Verse]', '||: G6    Dm7', 'Am7/E   Baug', 'G6 A7', 'Aø D7.  :||']
];

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  console.log('PASS ', label);
  passed++;
}
function eq(a, b, label) {
  assert.strictEqual(a, b, `${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  console.log('PASS ', label);
  passed++;
}

// ---- Token-level notation from Rob's charts ----
eq(transposeToken('A-7', 2, false), 'B-7', 'dash minor: A-7 -> B-7');
eq(transposeToken('Ebº7', 2, false), 'Fº7', 'º diminished: Ebº7 -> Fº7');
eq(transposeToken('C∆', 2, false), 'D∆', '∆ major-7 (U+2206): C∆ -> D∆');
eq(transposeToken('G+', 2, false), 'A+', 'augmented: G+ -> A+');
eq(transposeToken('Bø', 2, false), 'C#ø', 'half-diminished: Bø -> C#ø');
eq(transposeToken('G/B', 2, false), 'A/C#', 'slash: G/B -> A/C#');
eq(transposeToken('A-7/C', 2, false), 'B-7/D', 'minor slash: A-7/C -> B-7/D');
eq(transposeToken('<C6>', 2, false), '<D6>', 'angle-bracketed chord moves');
eq(transposeToken('*C∆', 2, false), '*D∆', 'starred chord moves');
eq(transposeToken('N.C.', 2, false), 'N.C.', 'N.C. is not a chord and must not move');
eq(transposeToken('(N.C.)', 2, false), '(N.C.)', '(N.C.) also untouched');
eq(transposeToken('1:', 2, false), '1:', 'volta label untouched');

// ---- Cell-level: unspaced pipe splits ----
eq(transposeCellText('Bb7|A7', 2, false), 'C7|B7', 'unspaced pipe: both sides move');
eq(transposeCellText('C |Bb7 B', 2, false), 'D |C7 C#', 'pipe glued to next chord');
eq(transposeCellText('D7| D-7', 2, false), 'E7| E-7', 'pipe glued to previous chord');
eq(transposeCellText('1: Eb7 |D 2: Bb7', 2, false), '1: F7 |E 2: C7', 'voltas with chords');
eq(transposeCellText('Gm | (Db9)', 2, true), 'Am | (Eb9)', 'parenthesised chord moves (flats)');
eq(transposeCellText('D7    :|', 2, false), 'E7    :|', 'repeat sign preserved');

// ---- Chord recognition ----
ok(isChordToken('A-7'), 'A-7 recognised as chord');
ok(isChordToken('Ebº7'), 'Ebº7 recognised as chord');
ok(isChordToken('C∆'), 'C∆ recognised as chord');
ok(isChordToken('E7/G#'), 'slash chord recognised (was previously missed)');
ok(isChordToken('<C6>'), '<C6> recognised as chord');
ok(!isChordToken('N.C.'), 'N.C. is not a chord');
ok(!isChordToken('lick'), '"lick" is not a chord');
ok(!isChordToken('Intro'), '"Intro" is not a chord');

// ---- Table detection on real charts ----
ok(isChordTable(YOU_DONT_KNOW_ME), "You Don't Know Me detected as chart");
ok(isChordTable(IS_YOU_IS_MAIN), 'Is You Is detected as chart');
ok(isChordTable(COME_FLY_INTRO), 'single-row intro fragment detected as chart');
ok(isChordTable(COME_FLY_OUTRO), 'outro fragment detected as chart');
ok(isChordTable(FIRST_KISS_F), "Ernie's chart still detected");

// ---- Label column detection ----
ok(!detectLabelColumn(YOU_DONT_KNOW_ME), 'no label column when col 0 holds chords');
ok(detectLabelColumn(IS_YOU_IS_MAIN), 'bare A/B/C section letters are labels');
ok(detectLabelColumn(FIRST_KISS_F), '[Intro]/[Verse] labels detected');
ok(!detectLabelColumn(COME_FLY_MAIN), 'Come Fly col 0 chords are not labels');
ok(!detectLabelColumn([['A', 'D', 'E', 'A'], ['A', 'D', 'E', 'A']]),
   'bare letters that are not an A,B,C.. sequence stay chords');

// ---- Key detection respects the label column ----
eq(detectKeyFromChart(YOU_DONT_KNOW_ME), 'C', 'key of You Dont Know Me = C');
eq(detectKeyFromChart(IS_YOU_IS_MAIN), 'G', 'key skips the A/B/C labels -> G(m)');
eq(detectKeyFromChart(COME_FLY_INTRO), 'C', 'fragment key from col 0');
eq(detectKeyFromChart(FIRST_KISS_F), 'F', "Ernie's key still F");

// ---- Grouping: split charts merge, different keys stay apart ----
{
  const groups = buildChartGroups([COME_FLY_INTRO, COME_FLY_MAIN, COME_FLY_OUTRO]);
  eq(groups.length, 1, 'Come Fly: three fragments form one chart');
  eq(groups[0].parts.length, 3, '...with three parts');
  eq(groups[0].parts[2].chordTableIndex, 2, 'parts remember their table position');
}
{
  const groups = buildChartGroups([FIRST_KISS_F, FIRST_KISS_G]);
  eq(groups.length, 2, "Ernie's F and G tables stay separate charts");
}
{
  const groups = buildChartGroups([IS_YOU_IS_INTRO, IS_YOU_IS_MAIN]);
  eq(groups.length, 1, 'Is You Is intro + main share a key -> one chart');
}

// ---- Full transposition of a Rob chart, C -> D ----
{
  const t = YOU_DONT_KNOW_ME.map(row => row.map(c => transposeCellText(c, 2, false)));
  eq(t[0][0], 'D | A+', 'col 0 transposes when it holds chords');
  eq(t[0][3], 'G#º', 'F#º -> G#º');
  eq(t[2][1], 'D∆ | B7', 'C∆ | A7 -> D∆ | B7');
  eq(t[3][6], 'D |C7 C#', 'C |Bb7 B -> D |C7 C#');
}

// ---- Pasted-chart parsing ----
{
  const tsv = 'C | G+\tF6\tF#º\nC∆ | A7\tD-7\tG7';
  const parts = parsePastedChart(tsv);
  eq(parts.length, 1, 'TSV paste: one part');
  eq(parts[0][0][2], 'F#º', 'TSV cells split on tabs');
  eq(parts[0][1][0], 'C∆ | A7', 'internal pipes survive TSV parsing');
}
{
  const twoBlocks = 'C6\tEbº7\tD-7\tG+\n\nC∆ | C6\tF7\tEø | Bb7\tA7';
  const parts = parsePastedChart(twoBlocks);
  eq(parts.length, 2, 'blank line splits paste into parts');
}
{
  const md = '|  |  |  |\n| :-: | :-: | :-: |\n| Am7 | Dm7 | G7 |';
  const parts = parsePastedChart(md);
  eq(parts.length, 1, 'markdown-style paste parsed');
  eq(parts[0].length, 1, 'separator and empty rows dropped');
  eq(parts[0][0][1], 'Dm7', 'markdown cells split on pipes');
}
{
  const spaced = 'Am7    Dm7    G7    C∆';
  const parts = parsePastedChart(spaced);
  eq(parts[0][0].length, 4, 'runs of spaces split into cells');
}

console.log(`\nAll ${passed} chart tests passed.`);
