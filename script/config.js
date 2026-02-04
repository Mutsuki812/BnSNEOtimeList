/* ==========================
   ======= 設定 & 定数 =======
   ========================== */

export const CONFIG = {
  EXCEL_URL: "./files/timeList.xlsx",
  REPORT_STORAGE_KEY: "myReports",
  ADMIN_KEY: "tp6ao354",
  REFRESH_INTERVAL: 60000, // 1分
  HOUR_INTERVAL: 3600000, // 1時間
};

export const TASK_TYPES = [
  { key: "gishiki", labelZh: "可疑的儀式", labelJp: "怪しい儀式", color: "#7a4171", offsetMin: 10 },
  { key: "mizuki", labelZh: "水月野王", labelJp: "水月FB", color: "#1e50a2", offsetMin: 5 },
  { key: "shirao", labelZh: "白青野王", labelJp: "白青FB", color: "#7b8d42", offsetMin: 5 },
  { key: "sengen", labelZh: "仙幻島野王", labelJp: "仙幻島FB", color: "#B08F3E", offsetMin: 5 },
];

export const REPORTTASK_TYPES = ["可疑的儀式","白青野王","仙幻島野王","其他"];

export const REPORT_TYPES = {
  default: ["數據提供","時間修正","地點修正"],
  otherOnly: ["其他"]
};

export const DATE_RANGES = {
  zh: {
    start: new Date('2026-01-21T04:00:00+08:00'),
    end: new Date('2026-01-28T03:59:59+08:00')
  },
  jp: {
    start: new Date('2025-12-17T06:00:00+09:00'),
    end: new Date('2025-12-24T05:59:59+09:00')
  }
};

export const MAINTENANCE_PATTERN = /例行維護中|定期メンテナンス中/;

export const WEEKDAYS = {
  zh: ["日", "一", "二", "三", "四", "五", "六"],
  jp: ["日", "月", "火", "水", "木", "金", "土"]
};

export const TEXTS = {
  notice: {
    zh: "<b>仙幻島第１賽季　2026.01.21 - 2026.02.25</b><br>" +
      "・表記時間 = 系統出字時間<br>" +
      "・儀式：出字提示後 3分鐘Boss登場、沒人打 30分鐘後消失<br>" +
      "・白青/仙幻島野王：出字提示後 5分鐘Boss登場。<br>",

    jp: "<b>ソウルパス白青シーズン4　2025.12.17 - </b><br>" +
      "・表の時間 ＝ システムが予兆文字を表示する時間<br>" +
      "・儀式：予兆後、3分でボスが出現し、<br>" +
      "　誰も攻撃しない場合、30分後に消滅<br>" +
      "・水月/白青島FB：予兆後、5分でボスが出現します。<br>" +
      "<spen style=\"color:red\">" +
      "　2026/03/11 AM11:00 にサービス終了となるため、<br>" + 
      "　このスケジュールは2025/12/24以降更新されません。" +
      "</spen><br>",
  },
  
  firstWeek:{
    zh: "",
    jp: "",
  },

  previousHourHint: {
    zh: "可能還沒死,可以找找看",
    jp: "未クリアの可能性もあり、<br>探してみよう"
  }
};