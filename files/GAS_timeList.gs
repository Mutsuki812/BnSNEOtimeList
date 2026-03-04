/* files/GAS_timeList.gs */

function doGet(e) {
  var params = e.parameter;
  var action = params.action;

  // 新版即時回報系統：獲取最新報告
  if (action === "getLastReports") {
    return getLastReports();
  } 
  // 新版即時回報系統：獲取今日歷史紀錄
  else if (action === "getHistory") {
    return getHistory(params.taskType);
  }
  
  // 預設行為：舊的回報系統讀取 (reportManager.js)
  return getOldReports();
}

function doPost(e) {
  try {
    var jsonData = JSON.parse(e.postData.contents);
    
    // 新版即時回報系統：提交報告
    if (jsonData.action === "reportOnline") {
      return handleOnlineReport(jsonData);
    }
    
    // 預設行為：舊的回報系統提交 (reportManager.js)
    return handleOldReport(jsonData);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// === 新版即時回報系統 (OnlinePrediction) ===
// ==========================================

function getLastReports() {
  var sheet = getOrCreateSheet("OnlineReports");
  var data = sheet.getDataRange().getValues();
  
  // 初始化結果結構
  var result = {
    gishiki: [],
    shirao: [],
    sengen: []
  };

  if (data.length < 2) {
    return responseJSON({ status: "success", data: result });
  }

  var headers = data[0];
  var rows = data.slice(1);
  
  // 取得伺服器時間 (使用 GMT+8 確保與台灣時間一致)
  var timeZone = "GMT+8";
  var now = new Date();
  var todayStr = Utilities.formatDate(now, timeZone, "yyyy-MM-dd");
  var yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  var yesterdayStr = Utilities.formatDate(yesterday, timeZone, "yyyy-MM-dd");
  var sheetTimeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();

  // 欄位索引對應
  var idx = {
    taskType: headers.indexOf("TaskType"),
    time: headers.indexOf("Time"),
    reportDate: headers.indexOf("ReportDate"),
    location: headers.indexOf("Location"),
    method: headers.indexOf("Method"),
    gishikiA: headers.indexOf("GishikiA"),
    gishikiB: headers.indexOf("GishikiB")
  };

  // 遍歷所有資料，只回傳今天和昨天的數據
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    
    // 處理日期格式：如果是 Date 物件則轉為字串，否則直接轉字串
    var cellValue = row[idx.reportDate];
    var rDate;
    if (cellValue instanceof Date) {
      rDate = Utilities.formatDate(cellValue, sheetTimeZone, "yyyy-MM-dd");
    } else {
      rDate = String(cellValue);
    }
    
    if (rDate === todayStr || rDate === yesterdayStr) {
      var type = row[idx.taskType];
      if (result[type]) {
        var timeVal = row[idx.time];
        var timeStr = (timeVal instanceof Date) ? Utilities.formatDate(timeVal, sheetTimeZone, "HH:mm") : String(timeVal);
        result[type].push({
          time: timeStr,
          reportDate: rDate,
          location: row[idx.location],
          method: row[idx.method],
          locationA: row[idx.gishikiA], // 對應前端 gishikiA
          locationB: row[idx.gishikiB]  // 對應前端 gishikiB
        });
      }
    }
  }

  return responseJSON({ status: "success", data: result });
}

function handleOnlineReport(data) {
  var sheet = getOrCreateSheet("OnlineReports");
  
  // 如果是新表，建立標題列
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "TaskType", "Time", "ReportDate", "Location", "Method", "GishikiA", "GishikiB"]);
  }
  
  sheet.appendRow([
    new Date(),
    data.taskType,
    data.time,
    data.reportDate, // 前端傳來的 YYYY-MM-DD
    data.location || "",
    data.method || "",
    data.gishikiA || "",
    data.gishikiB || ""
  ]);
  
  return responseJSON({ status: "success" });
}

function getHistory(taskType) {
  var sheet = getOrCreateSheet("OnlineReports");
  var data = sheet.getDataRange().getValues();
  
  if (data.length < 2) return responseJSON({ status: "success", data: [] });

  var headers = data[0];
  var rows = data.slice(1);
  var timeZone = "GMT+8";
  var todayStr = Utilities.formatDate(new Date(), timeZone, "yyyy-MM-dd");
  var sheetTimeZone = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  
  var idx = {
    taskType: headers.indexOf("TaskType"),
    time: headers.indexOf("Time"),
    reportDate: headers.indexOf("ReportDate"),
    location: headers.indexOf("Location"),
    method: headers.indexOf("Method"),
    gishikiA: headers.indexOf("GishikiA"),
    gishikiB: headers.indexOf("GishikiB")
  };

  var history = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    
    var cellValue = row[idx.reportDate];
    var rDate;
    if (cellValue instanceof Date) {
      rDate = Utilities.formatDate(cellValue, sheetTimeZone, "yyyy-MM-dd");
    } else {
      rDate = String(cellValue);
    }

    // 只回傳指定類型且為今天的紀錄
    if (row[idx.taskType] === taskType && rDate === todayStr) {
      var timeVal = row[idx.time];
      var timeStr = (timeVal instanceof Date) ? Utilities.formatDate(timeVal, sheetTimeZone, "HH:mm") : String(timeVal);
      history.push({
        time: timeStr,
        location: row[idx.location],
        method: row[idx.method],
        gishikiA: row[idx.gishikiA],
        gishikiB: row[idx.gishikiB]
      });
    }
  }
  
  // 反轉陣列讓最新的顯示在最上方 (假設 appendRow 是依序加入)
  return responseJSON({ status: "success", data: history.reverse() });
}

// ==========================================
// === 舊版回報系統 (ReportManager) ===
// ==========================================

function getOldReports() {
  var sheet = getOrCreateSheet("Reports");
  var data = sheet.getDataRange().getValues();
  var result = [];
  
  if (data.length > 1) {
    var headers = data[0];
    var idx = {
      Timestamp: headers.indexOf("Timestamp"),
      TaskType: headers.indexOf("TaskType"),
      ReportType: headers.indexOf("ReportType"),
      Comment: headers.indexOf("Comment"),
      Respond: headers.indexOf("Respond")
    };
    
    // 取最後 50 筆
    var start = Math.max(1, data.length - 50);
    for (var i = data.length - 1; i >= start; i--) {
      var row = data[i];
      result.push({
        Timestamp: row[idx.Timestamp],
        TaskType: row[idx.TaskType],
        ReportType: row[idx.ReportType],
        Comment: row[idx.Comment],
        Respond: row[idx.Respond]
      });
    }
  }
  
  return responseJSON({ status: "success", data: result });
}

function handleOldReport(data) {
  var sheet = getOrCreateSheet("Reports");
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "TaskType", "ReportType", "Comment", "Respond"]);
  }
  
  sheet.appendRow([
    new Date(),
    data.taskType,
    data.reportType,
    data.comment,
    "FALSE"
  ]);
  
  return responseJSON({ status: "success" });
}

// ==========================================
// === 工具函式 ===
// ==========================================

function getOrCreateSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function formatDate(date) {
  var y = date.getFullYear();
  var m = ('0' + (date.getMonth() + 1)).slice(-2);
  var d = ('0' + date.getDate()).slice(-2);
  return y + '-' + m + '-' + d;
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
