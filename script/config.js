/* ==========================
   ======= 設定 & 常數 =======
   ========================== */

export const CONFIG = {
  EXCEL_URL: "./files/timeList.xlsx",
  // GAS 時間表資料來源 URL
  GAS_DATA_URL: "https://script.google.com/macros/s/AKfycbzrg0szQBpHlzMyEpel1_CvXYey-Ps1rCKUyDsRmIBeiImsKs_jbueA-lQjTaH8O47bZg/exec",
  REFRESH_INTERVAL: 60000, // 1分鐘
  HOUR_INTERVAL: 3600000, // 1小時
  XLSX_CDN: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
};

export const TASK_TYPES = [
  { key: "gishiki", label: "可疑的儀式", color: "#7a4171", offsetMin: 10 },
  { key: "shirao", label: "白青野王", color: "#7b8d42", offsetMin: 5 },
  { key: "sengen", label: "仙幻島野王", color: "#B08F3E", offsetMin: 5 },
];

export const REPORT_TASK = ["可疑的儀式","白青野王","仙幻島野王","其他"];

export const REPORT_TYPES = {
  default: ["數據提供","時間修正","地點修正"],
  otherOnly: ["音效相關","BUG回報","想說"]
};

export const MAINTENANCE_PATTERN = /例行維護中/;

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export const DATE_RANGES = {
  start: new Date('2026-03-09T10:00:00+08:00'),
  end: new Date('2026-03-10T05:59:59+08:00')
};

export const TEXTS = {
  regularNotice:
    "<b>仙幻島第２賽季　2026.02.25 - 2026.03.25</b><br>" +
    "・表記時間 = 系統出字時間<br>" +
    "・儀式：出字提示後 3分鐘Boss登場、沒人打 30分鐘後消失。<br>" +
    "・白青/仙幻島野王：出字提示後 5分鐘Boss登場。<br>" +
    "<spen style=\"color:red\">" +
    "　<b>畫面或音效出現異常時 煩請刷新或刪除網頁Cookie</b><br>" +
    "</spen>",
  
  temporaryNotice:
    "<spen style=\"color:red\">" +
    "　即時回報系統測試使用中" +
    "</spen>",

  previousHourHint: {
    gishiki: "可能還沒死，可以找找看",
    default: "跑圖快的，還不快飛"
  }
};