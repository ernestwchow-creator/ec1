// Verifies replaceChart's index arithmetic against a simulated document.
//
// Every edit shifts the indices of everything after it, so the generated
// requests are applied to a text buffer in order and the result compared with
// what the chart should read afterwards. Getting this wrong in the real API
// silently corrupts the document, so it is worth simulating.
const assert = require('assert');
const { google } = require('googleapis');
const { replaceChart } = require('./src/docs');

// Builds a document whose text buffer is the cells concatenated, each cell a
// paragraph ending in a newline, with Docs-style 1-based indices.
function buildDoc(cells) {
  let buffer = '';
  let index = 1; // Docs body content starts at index 1
  const tableRows = cells.map(row => ({
    tableCells: row.map(text => {
      const content = text + '\n';
      const startIndex = index;
      const endIndex = index + content.length;
      buffer += content;
      index = endIndex;
      return {
        content: [{
          startIndex,
          endIndex,
          paragraph: { elements: [{ startIndex, endIndex, textRun: { content } }] }
        }]
      };
    })
  }));
  return { doc: { body: { content: [{ table: { tableRows } }] } }, buffer };
}

function applyRequests(buffer, requests) {
  // Buffer position 0 corresponds to document index 1.
  let text = buffer;
  for (const r of requests) {
    if (r.deleteContentRange) {
      const { startIndex, endIndex } = r.deleteContentRange.range;
      text = text.slice(0, startIndex - 1) + text.slice(endIndex - 1);
    } else if (r.insertText) {
      const i = r.insertText.location.index;
      text = text.slice(0, i - 1) + r.insertText.text + text.slice(i - 1);
    }
  }
  return text;
}

async function run(before, after) {
  const { doc, buffer } = buildDoc(before);
  let captured = [];
  const original = google.docs;
  google.docs = () => ({
    documents: {
      get: async () => ({ data: doc }),
      batchUpdate: async ({ requestBody }) => { captured = requestBody.requests; return {}; }
    }
  });
  try {
    await replaceChart({}, 'doc-id', () => true, [0], [after]);
  } finally {
    google.docs = original;
  }
  const expected = after.map(row => row.map(c => c + '\n').join('')).join('');
  return { result: applyRequests(buffer, captured), expected, requests: captured };
}

(async () => {
  // 1. The real case: a chart transposed from F to G.
  let t = await run(
    [['[Intro]', '||: F6      Aaug', 'BbΔ   Gø'],
     ['[Verse]', '||: F6    Cm7', 'Gm7/D   Aaug']],
    [['[Intro]', '||: G6      Baug', 'CΔ   Aø'],
     ['[Verse]', '||: G6    Dm7', 'Am7/E   Baug']]
  );
  assert.strictEqual(t.result, t.expected);
  console.log('PASS  transposed chart rewritten correctly');

  // 2. Newlines must survive: deleting one would collapse the table.
  assert.strictEqual((t.result.match(/\n/g) || []).length, 6);
  console.log('PASS  every cell keeps its terminating newline');

  // 3. Growing and shrinking text, which shifts later indices in both directions.
  t = await run(
    [['a', 'bb', 'ccc']],
    [['aaaaaaaa', 'b', 'cc']]
  );
  assert.strictEqual(t.result, t.expected);
  console.log('PASS  handles cells that grow and shrink');

  // 4. Emptying a cell, and filling a previously empty one.
  t = await run(
    [['keep', 'remove', '']],
    [['keep', '', 'added']]
  );
  assert.strictEqual(t.result, t.expected);
  console.log('PASS  handles emptied and newly filled cells');

  // 5. An unchanged chart should produce no requests at all.
  t = await run([['x', 'y']], [['x', 'y']]);
  assert.strictEqual(t.requests.length, 0);
  assert.strictEqual(t.result, t.expected);
  console.log('PASS  identical content produces no edits');

  // 6. Ragged rows: fewer new values than cells empties the remainder.
  t = await run([['a', 'b', 'c']], [['a']]);
  assert.strictEqual(t.result, 'a\n\n\n');
  console.log('PASS  missing values clear their cells');

  // 7. With several charts in one document, only the selected one is touched.
  //    Docs like "First Kiss" hold the original, a transposed copy, and a
  //    Roman-numeral table, so targeting the wrong one would corrupt a chart.
  {
    let buffer = '';
    let index = 1;
    const makeTable = (cells) => ({
      table: {
        tableRows: cells.map(row => ({
          tableCells: row.map(text => {
            const content = text + '\n';
            const startIndex = index;
            const endIndex = index + content.length;
            buffer += content;
            index = endIndex;
            return {
              content: [{
                startIndex, endIndex,
                paragraph: { elements: [{ startIndex, endIndex, textRun: { content } }] }
              }]
            };
          })
        }))
      }
    });
    const doc = { body: { content: [makeTable([['A1', 'A2']]), makeTable([['B1', 'B2']])] } };

    let captured = [];
    const original = google.docs;
    google.docs = () => ({
      documents: {
        get: async () => ({ data: doc }),
        batchUpdate: async ({ requestBody }) => { captured = requestBody.requests; return {}; }
      }
    });
    try {
      // part index 1 -> the second table only
      await replaceChart({}, 'doc-id', () => true, [1], [[['X1', 'X2']]]);
    } finally {
      google.docs = original;
    }

    assert.strictEqual(applyRequests(buffer, captured), 'A1\nA2\nX1\nX2\n');
    console.log('PASS  edits only the selected chart, leaving others intact');
  }

  // 8. A split chart: both fragments rewritten in one pass, indices intact.
  {
    let buffer = '';
    let index = 1;
    const makeTable = (cells) => ({
      table: {
        tableRows: cells.map(row => ({
          tableCells: row.map(text => {
            const content = text + '\n';
            const startIndex = index;
            const endIndex = index + content.length;
            buffer += content;
            index = endIndex;
            return {
              content: [{
                startIndex, endIndex,
                paragraph: { elements: [{ startIndex, endIndex, textRun: { content } }] }
              }]
            };
          })
        }))
      }
    });
    const doc = { body: { content: [
      makeTable([['C6', 'Ebº7']]),          // intro fragment
      makeTable([['C∆ | C6', 'F7']])        // body fragment
    ] } };

    let captured = [];
    const original = google.docs;
    google.docs = () => ({
      documents: {
        get: async () => ({ data: doc }),
        batchUpdate: async ({ requestBody }) => { captured = requestBody.requests; return {}; }
      }
    });
    try {
      await replaceChart({}, 'doc-id', () => true, [0, 1],
        [[['D6', 'Fº7']], [['D∆ | D6', 'G7']]]);
    } finally {
      google.docs = original;
    }

    assert.strictEqual(applyRequests(buffer, captured), 'D6\nFº7\nD∆ | D6\nG7\n');
    console.log('PASS  split chart: both fragments rewritten in one batch');
  }

  console.log('\nAll replaceChart tests passed.');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
