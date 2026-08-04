const { google } = require('googleapis');

function extractDocId(url) {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
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

module.exports = { extractDocId, extractTables, readDocument, appendTransposedChart };
