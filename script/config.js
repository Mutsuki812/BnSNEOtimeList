/* ==========================
   ======= 設定 & 常數 =======
   ========================== */

export const CONFIG = {
  // Supabase 設定
  // 1. SDK 來源
  SUPABASE_CDN: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js",
  // 2. 專案網址
  SUPABASE_URL: "https://bagzrimxitmegqpmvnfi.supabase.co",
  // 3. Publishable Key
  SUPABASE_KEY: "sb_publishable_IBRmc1srGQDHE37cn_f-ZQ_-vzy-NdW",

  REFRESH_INTERVAL: 60000, // 1分鐘
  HOUR_INTERVAL:  3600000, // 1小時
};

export const TASK_TYPES = [
  { key: "gishiki", label: "可疑的儀式", color: "#7a4171", offsetMin: 10, useOnlineSystem: true },
  { key: "shirao", label: "白青野王", color: "#7b8d42", offsetMin: 5, useOnlineSystem: true },
  { key: "sengen", label: "仙幻島野王", color: "#B08F3E", offsetMin: 5, useOnlineSystem: true },
];

export const REPORT_TASK = ["可疑的儀式","白青野王","仙幻島野王","其他"];

export const REPORT_TYPES = {
  default: ["數據提供","時間修正","地點修正"],
  otherOnly: ["音效相關","BUG回報","想說"]
};

export const MAINTENANCE_PATTERN = /例行維護中/;

export const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export const DATE_RANGES = {
  start: new Date('2026-04-29T05:00:00+08:00'),
  end: new Date('2026-05-06T05:59:59+08:00')
};

export const TEXTS = {
  titleNotice:
    "<b>仙幻島第４賽季　2026.04.29 - 2026.05.27</b><br>",

  regularNotice:
    "・表記時間 = 系統出字時間<br>" +
    "・儀式：出字提示後 3分鐘Boss登場、沒人打30分鐘後消失。<br>" +
    "・白青/仙幻島野王：出字提示後5分鐘Boss登場。<br>",
  
  temporaryNotice:
    "<span style=\"color:var(--color-text-red)\">" +
    // "・畫面/音效出現異常時 煩請強制刷新Ctrl+F5<br>" +
    "・該系統極致仰賴各位回報者的準確度 如有錯誤的回報 請記得自行刪除<br>" +
    "・回報或留言需登入名稱（點擊回報左側的時鐘 可以查看或刪除歷史紀錄）<br>" +
    // "・登入系統使用瀏覽器環境綁定 若發生「名稱無法使用」請在最下方留言告知<br>" +
    "・手機板目前炸掉了 不建議使用<br>" +
    "</span>",

  previousHourHint: {
    gishiki: "可能還沒死，可以找找看",
    shirao: "跑圖快的，還不快飛",
    sengen: "跑圖快的，還不快飛"
  },

  Report_regularNotice:
  "野王重置 當週請使用上方↑↑↑↑↑ 回報<br>",

  Report_temporaryNotice:
  "有想說的 可以留言在這裡↓↓↓↓↓ 感謝",
};