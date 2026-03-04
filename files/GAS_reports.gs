// Google Apps Script (Code.gs)

const SHEET_NAME = "Msg";

function doGet(e) {
  let response;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    
    // 檢查工作表是否存在，若不存在則報錯
    if (!sheet) {
      throw new Error(`Sheet "${SHEET_NAME}" not found.`);
    }

    const lastRow = sheet.getLastRow();
    let reports = []; 

    // 如果有資料 (大於 1 行，因為第 1 行是標題)
    if (lastRow >= 2) {
      const dataRange = sheet.getRange(2, 1, lastRow - 1, 5);
      const values = dataRange.getValues();

      reports = values.map(row => ({
        Timestamp: formatGasTimestamp(row[0]),
        TaskType: row[1],
        ReportType: row[2],
        Comment: row[3],
        Respond: row[4]
      })).reverse(); // 最新資料排前面
    }
    
    response = { status: 'success', data: reports };

  } catch (error) {
    response = { status: 'error', message: error.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let response;
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    
    if (!sheet) {
      throw new Error(`Sheet "${SHEET_NAME}" not found.`);
    }

    const data = JSON.parse(e.postData.contents);

    if (!data.comment) {
      throw new Error("Comment is missing.");
    }

    sheet.appendRow([
      new Date(),
      data.taskType,
      data.reportType,
      data.comment,
      data.respond
    ]);

    response = { status: 'success', message: 'Report added' };

  } catch (error) {
    response = { status: 'error', message: error.message };
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

function formatGasTimestamp(date) {
  if (!(date instanceof Date)) return date;
  const pad = (n) => String(n).padStart(2, '0');
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${month}/${day} ${hours}:${minutes}`;
}