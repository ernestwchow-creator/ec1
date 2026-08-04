const { google } = require('googleapis');

function extractDocId(url) {
  const trimmed = String(url || '').trim();
  const match = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Accept a bare file ID, which is what the Drive browser hands us.
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

async function copyDocument(auth, fileId, newName) {
  const drive = google.drive({ version: 'v3', auth });
  const res = await drive.files.copy({
    fileId,
    requestBody: { name: newName },
    fields: 'id,name,webViewLink'
  });
  return res.data;
}

function getCellText(cell) {
  let text = '';
  for (const content of cell.content || []) {
    if (content.paragraph) {
      for (const elem of content.paragraph.elements || []) {
        if (elem.textRun) {
          text += elem.textRun.content;
        }
      }
    }
  }
  return text.replace(/\n$/, '').trim();
}

function extractTables(doc) {
  const tables = [];
  for (const element of doc.body.content || []) {
    if (element.table) {
      const tableData = [];
      for (const row of element.table.tableRows || []) {
        const rowData = [];
        for (const cell of row.tableCells || []) {
          rowData.push(getCellText(cell));
        }
        tableData.push(rowData);
      }
      tables.push({
        data: tableData,
        rows: element.table.rows,
        columns: element.table.columns,
        startIndex: element.startIndex,
        endIndex: element.endIndex
      });
    }
  }
  return tables;
}

async function readDocument(auth, documentId) {
  const docs = google.docs({ version: 'v1', auth });
  const response = await docs.documents.get({ documentId });
  return response.data;
}

async function appendTransposedChart(auth, documentId, chartData, title) {
  const docs = google.docs({ version: 'v1', auth });

  let doc = await docs.documents.get({ documentId });
  let endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex;

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{
        insertText: {
          location: { index: endIndex - 1 },
          text: '\n' + title + '\n'
        }
      }]
    }
  });

  doc = await docs.documents.get({ documentId });
  endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex;

  const rows = chartData.length;
  const columns = Math.max(...chartData.map(r => r.length));

  await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [{
        insertTable: {
          rows,
          columns,
          location: { index: endIndex - 1 }
        }
      }]
    }
  });

  doc = await docs.documents.get({ documentId });
  const allTables = doc.data.body.content.filter(e => e.table);
  const newTable = allTables[allTables.length - 1];

  if (!newTable || !newTable.table) {
    throw new Error('Failed to create table in document');
  }

  const cellRequests = [];
  const tableRows = newTable.table.tableRows;

  for (let r = tableRows.length - 1; r >= 0; r--) {
    const cells = tableRows[r].tableCells;
    for (let c = cells.length - 1; c >= 0; c--) {
      const cellText = (chartData[r] && chartData[r][c]) ? chartData[r][c] : '';
      if (!cellText) continue;

      const para = cells[c].content && cells[c].content[0];
      if (!para || !para.paragraph) continue;
      const insertIdx = para.paragraph.elements[0].startIndex;

      cellRequests.push({
        insertText: {
          location: { index: insertIdx },
          text: cellText
        }
      });
    }
  }

  if (cellRequests.length > 0) {
    await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests: cellRequests }
    });
  }

  doc = await docs.documents.get({ documentId });
  const updatedTables = doc.data.body.content.filter(e => e.table);
  const finalTable = updatedTables[updatedTables.length - 1];

  if (finalTable && finalTable.table) {
    const alignRequests = [];
    for (const row of finalTable.table.tableRows) {
      for (const cell of row.tableCells) {
        for (const content of cell.content || []) {
          if (content.paragraph) {
            alignRequests.push({
              updateParagraphStyle: {
                range: {
                  startIndex: content.startIndex,
                  endIndex: content.endIndex
                },
                paragraphStyle: { alignment: 'CENTER' },
                fields: 'alignment'
              }
            });
          }
        }
      }
    }
    if (alignRequests.length > 0) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: alignRequests }
      });
    }
  }
}

function tableToData(table) {
  return (table.tableRows || []).map(row =>
    (row.tableCells || []).map(getCellText)
  );
}

// Rewrites a chart in place, used on a freshly copied document so the copy
// reads as a chart in the new key rather than the original plus an appendix.
//
// Two constraints drive the shape of this: a cell's trailing newline ends its
// paragraph and deleting it would collapse the table, and every edit shifts the
// indices of everything after it. So each cell is trimmed to its text only, and
// the whole document is walked back to front.
async function replaceChart(auth, documentId, isTargetTable, chartIndex, newData) {
  const docs = google.docs({ version: 'v1', auth });
  const doc = (await docs.documents.get({ documentId })).data;

  const matches = (doc.body.content || [])
    .filter(el => el.table)
    .map(el => el.table)
    .filter(table => isTargetTable(tableToData(table)));

  const table = matches[chartIndex];
  if (!table) {
    const err = new Error('Chord chart not found in the copied document');
    err.code = 404;
    throw err;
  }

  const requests = [];
  const rows = table.tableRows || [];

  for (let r = rows.length - 1; r >= 0; r--) {
    const cells = rows[r].tableCells || [];
    for (let c = cells.length - 1; c >= 0; c--) {
      const newText = (newData[r] && newData[r][c]) || '';
      const paragraphs = (cells[c].content || []).filter(x => x.paragraph);
      if (!paragraphs.length) continue;

      // Range of a paragraph's text, excluding the newline that terminates it.
      const textRange = (para) => {
        const runs = (para.paragraph.elements || []).filter(e => e.textRun);
        if (!runs.length) return null;
        const last = runs[runs.length - 1];
        const end = last.textRun.content.endsWith('\n') ? last.endIndex - 1 : last.endIndex;
        const text = runs.map(e => e.textRun.content).join('').replace(/\n$/, '');
        return { start: runs[0].startIndex, end, text };
      };

      const first = textRange(paragraphs[0]);
      const unchanged = paragraphs.length === 1 && first && first.text === newText;
      if (unchanged) continue;

      // Clear trailing paragraphs first so the first paragraph's indices hold.
      for (let p = paragraphs.length - 1; p >= 1; p--) {
        const range = textRange(paragraphs[p]);
        if (range && range.end > range.start) {
          requests.push({ deleteContentRange: { range: { startIndex: range.start, endIndex: range.end } } });
        }
      }

      const start = first ? first.start : paragraphs[0].startIndex;
      if (first && first.end > first.start) {
        requests.push({ deleteContentRange: { range: { startIndex: start, endIndex: first.end } } });
      }
      if (newText) {
        requests.push({ insertText: { location: { index: start }, text: newText } });
      }
    }
  }

  if (requests.length) {
    await docs.documents.batchUpdate({ documentId, requestBody: { requests } });
  }
  return requests.length;
}

module.exports = {
  extractDocId, extractTables, readDocument, appendTransposedChart,
  copyDocument, replaceChart, tableToData
};
