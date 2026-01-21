/* ==========================
   ======= 設定 & 資料 =======
   ========================== */

// ─── 連攜數據 ───
const EXCEL_URL = "./files/timeList.xlsx";

// ─── 任務文字 ───
const TASK_TYPES = [
  { key: "gishiki", labelZh: "可疑的儀式", labelJp: "怪しい儀式", color: "#7a4171", offsetMin: 10 },
  { key: "mizuki", labelZh: "水月野王", labelJp: "水月FB", color: "#1e50a2", offsetMin: 5 },
  { key: "shirao", labelZh: "白青野王", labelJp: "白青FB", color: "#7b8d42", offsetMin: 5 },
  { key: "sengen", labelZh: "仙幻島野王", labelJp: "仙幻島FB", color: "#B08F3E", offsetMin: 5 },
];

// ─── 維修文字 ───
const MAINTENANCE_PATTERN = /例行維護中|定期メンテナンス中/;

// ─── 特定時間：新一季的第一周 時間設定 ───
const dateRanges = {
  zh: {
    start: new Date('2026-01-21T11:00:00+08:00'), // 台灣
    end: new Date('2026-01-28T05:59:59+08:00')

  },
  jp: {
    start: new Date('2026-01-21T10:00:00+09:00'), // 日本
    end: new Date('2026-01-28T05:59:59+09:00')
  }
};

// ─── 回報表單 ───
const REPORT_STORAGE_KEY = "myReports";

// ─── 回報表單 - 任務區分 ───
const REPORTTASK_TYPES = [
  { key: "gishiki", labelZh: "可疑的儀式", labelJp: "怪しい儀式" },
  { key: "mizuki", labelZh: "水月野王", labelJp: "水月FB" },
  { key: "shirao", labelZh: "白青野王", labelJp: "白青FB" },
  { key: "sengen", labelZh: "仙幻島野王", labelJp: "仙幻島FB" },
  { key: "other", labelZh: "其他", labelJp: "その他" },
];

// ─── 回報表單 - 回報類型 ───
const REPORT_TYPES = {
  default: [
    { value: "date_report", labelZh: "時間回報", labelJp: "時間報告" },
    { value: "other", labelZh: "其他", labelJp: "その他" },
  ],
  otherOnly: [
    { value: "other", labelZh: "其他", labelJp: "その他" },
  ]
};



/* ==========================
   ===== 語系判定 & 切換 =====
   ========================== */

let lang = "zh";

// ─── 更新語系 ───
function updateHtmlLang() {
  document.documentElement.setAttribute('lang', lang);
}

// ─── 根據時區 判定語系 ───
function detectLangByTimezone() {
  // 檢查是否有儲存的語言偏好
  const savedLang = localStorage.getItem('userLang');

  if (savedLang) {
    // 有儲存的語言，使用儲存設定
    lang = savedLang;
  } else {
    // 第一次訪問，根據時區判定
    const timezoneOffset = -new Date().getTimezoneOffset() / 60;
    lang = timezoneOffset === 9 ? "jp" : "zh";
  }

  updateLangButtonText();
}

// ─── 根據語系 切換按鈕文字 ───
function updateLangButtonText() {
  document.getElementById("langBtn").textContent = lang === "zh" ? "日本鯖切替" : "切換到台服";
}

// ─── 切換語系 時間文字更新 ───
document.getElementById("langBtn").addEventListener("click", () => {
  lang = lang === "zh" ? "jp" : "zh";

  // 儲存使用者的語言選擇
  localStorage.setItem('userLang', lang);

  // 更新按鈕文字
  updateLangButtonText();

  // 更新語系
  updateHtmlLang();

  // 更新時間
  updateTopTime();

  // 根據期間重新初始化
  if (isInDateRange()) {
    initInDateRange();
  } else {
    initOutDateRange();
  }

  // 更新回報區文字
  updateReportText();
  updateReportTaskOptions();
  updateReportTypeOptions();
  updateReportCommentPlaceholder();
});

detectLangByTimezone();
updateHtmlLang();  // 初期設定時設定HTML語系



/* ==========================
   ======== 時間處理 ========
   ========================== */

// ─── 根據語系 取得對應時區時間 ───
function getNowBySVR() {
  const now     = new Date();
  const utc     = now.getTime() + now.getTimezoneOffset() * 60000;
  const offset  = (lang === "zh" ? 8 : 9) * 60 * 60000;

  return new Date(utc + offset);
}

// ─── 更新頁面頂部的（年/月/日（星期）） ───
function formatDateLabel(d) {
  const year    = d.getFullYear();
  const month   = d.getMonth() + 1;
  const day     = d.getDate();
  const weekdays = {
    zh: ["日", "一", "二", "三", "四", "五", "六"],
    jp: ["日", "月", "火", "水", "木", "金", "土"]
  };
  const weekday = weekdays[lang][d.getDay()];

  return `${year}/${month}/${day}（${weekday}）`;
}

// ─── 更新頁面頂部的時間顯示 ───
function updateTopTime() {
  const now = getNowBySVR();
  document.getElementById("dateLabel").textContent = formatDateLabel(now);

  const locale  = lang === "zh" ? "zh-TW" : "ja-JP";
  const options = { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const timeStr = now.toLocaleTimeString(locale, options);

  document.getElementById("timeBox").innerHTML = `
    <span class="timeLabel">${lang === "zh" ? "台灣時間" : "日本時間"}</span>
    <span class="timeValue">${timeStr}</span>
  `;
}

// ─── 將時間字串（HH:MM）轉換為今天的 Date 物件 ───
function timeStringToDateToday(timeStr) {
  const now     = getNowBySVR();
  const [h, m]  =  (timeStr || "--:--").split(":").map(Number);

  if (isNaN(h) || isNaN(m)) return null;

  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
}



/* =========================================
   ======= 當前日期是否為每一季的第一周 ======
   ========================================= */

// ─── 判斷當前是否在特定時間範圍內 ───
function isInDateRange() {
  const now   = getNowBySVR();      // 取得對應時區的當前時間
  const range = dateRanges[lang];   // 根據當前語系取得對應的時間範圍

  return now >= range.start && now <= range.end;
}



/* ==========================
   ========= 初始化 =========
   ========================== */

// ─── Excel 數據緩存和刷新控制 ───
let cachedExcelRows         = null;   // 緩存的 Excel 數據
let minuteRefreshIntervalId = null;   // 每分鐘刷新任務列表的定時器 ID

function initCommon({ showFirstWeek }) {
  const firstWeekDiv     = document.getElementById("firstWeek");
  const noticeDiv      = document.getElementById("notice");
  const taskContainerDiv = document.getElementById("taskContainer");

  // 處理：說明文字 notice 
  updateNotice();
  if (noticeDiv) {
    noticeDiv.style.display = "block";
  }

  // 處理：新一季的第一周 公告
  if (firstWeekDiv) {
    firstWeekDiv.style.display = showFirstWeek ? "block" : "none";
    // 當前日期為新一季的第一周 顯示文字
    if (showFirstWeek) {
      updateFirstWeekText();
    }
  }

  // 處理：任務列表
  if (taskContainerDiv) {
    taskContainerDiv.style.display = "block";
    loadTasksAndRender(); // 載入 Excel 並渲染任務
  }

  // 處裡：每分鐘刷新任務列表 UI（使用緩存數據）
  if (minuteRefreshIntervalId) {
    clearInterval(minuteRefreshIntervalId);
  }
  minuteRefreshIntervalId = setInterval(() => {
    if (cachedExcelRows) {
      renderAllGroups(cachedExcelRows); // 使用緩存數據刷新 UI
    }
  }, 60000);
}


/* ==========================
   ===== 特定時間初期化 =====
   ========================== */

// ─── 時間外 ───
function initOutDateRange() {
  initCommon({ showFirstWeek: false });
}
// ─── 時間內 ───
function initInDateRange() {
  initCommon({ showFirstWeek: true });
}

// ─── 時間內：公告文字 ───
function updateFirstWeekText() {
  let firstWeekDiv = document.getElementById("firstWeek");
  if (!firstWeekDiv) {
    firstWeekDiv = document.createElement("div");
    firstWeekDiv.id = "firstWeek";

    const mainCard = document.getElementById("mainCard");
    if (mainCard) {
      mainCard.appendChild(firstWeekDiv);
    }
  }
  const texts = {
    zh: "新的賽季的第一周 暫時沒有數據<br>" +
      "請各位大俠幫幫忙 辛苦各位了",
    jp: "新シーズンが始まったばかりのため、まだデータがありません。<br>" +
      "情報提供のご協力をよろしくお願いします！"
  };
  firstWeekDiv.innerHTML = texts[lang];
}

/* ==========================
   ======== 說明公告 ========
   ========================== */

// ─── 公告文字 ───
function updateNotice() {
  let noticeDiv = document.getElementById("notice");
  if (!noticeDiv) {
    noticeDiv = document.createElement("div");
    noticeDiv.id = "notice";
    noticeDiv.className = "notice";
    document.body.appendChild(noticeDiv);
  }
  const texts = {
    zh: "<b>仙幻島第１賽季　2026.01.21 - 2026.02.25</b><br>" +
      "・表記時間 = 系統出字時間<br>" +
      "・儀式：出字提示後３分鐘Boss登場、30分鐘後消失<br>" +
      "・白青/仙幻島野王：出字提示後５分鐘Boss登場。<br>" +
      "・時間有[?]，是路上不小心遇到，不是系統出字時間。<br>" +
      "　若有更準確的時間資訊，歡迎補充！<br>",
    jp: "<b>ソウルパス白青シーズン4　2025.12.17 - </b><br>" +
      "・表の時間 ＝ システムが予兆文字を表示した時間<br>" +
      "・儀式：予兆後、３分でボスが出現します。<br>" +
      "・白青/仙幻島FB：予兆後、５分でボスが出現します。<br>" +
      "・時間に[？]が付いている場合は、<br>" +
      "　ボスが散歩中に発見、予兆時間ではない。<br>" +
      "　もしより詳しい時間が分かれば、ぜひご提供ください。<br>"
  };
  noticeDiv.innerHTML = texts[lang];
}


/* ==========================
   ======= Excel 讀取 =======
   ========================== */

async function loadExcel() {
  try {

    // 雙表
    const SHEET_NAME = lang === "zh" ? "timeList" : "timeList_JP";

    const res = await fetch(EXCEL_URL);
    const buf = await res.arrayBuffer();
    const workbook = XLSX.read(buf, { type: "array" });
    const sheet = workbook.Sheets[SHEET_NAME] || workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
  } catch (err) {
    console.error("Excel 讀取失敗：", err);
    return [];
  }
}

/* ==========================
   ====== 合併維修處裡 ======
   ========================== */

// ─── 檢查是否為[維修] ───
function isMaintenanceTask(item) {
  if (!item) return false;
  const content = lang === "zh" ? item.zh : item.jp;
  return MAINTENANCE_PATTERN.test(content);
}

// ─── 根據當前語系 取得任務內容 ───
function getTaskContent(item) {
  return lang === "zh" ? item.zh : item.jp;
}

// ─── 合併連續的相同維修任務 ───
function mergeConsecutiveMaintenance(list) {
  const merged = [];
  let skipUntil = -1;

  list.forEach((item, index) => {
    // 跳過已處理的連續項目
    if (index < skipUntil) return;

    const content = getTaskContent(item);
    const isMaintenance = MAINTENANCE_PATTERN.test(content);

    if (isMaintenance) {
      // 找出連續相同的維修項目 並記錄時間範圍（start/end）
      let lastIndex = index;
      for (let i = index + 1; i < list.length; i++) {
        const nextContent = getTaskContent(list[i]);
        if (nextContent === content) {
          lastIndex = i;
        } else {
          break;
        }
      }
      // 取得開始與結束小時
      const startHour = parseInt(item.time.split(":")[0]);
      const endHour = parseInt(list[lastIndex].time.split(":")[0]);

      // 建立一筆合併項目，並保存 span 資訊
      const mergedItem = Object.assign({}, item);
      mergedItem.maintenanceSpanStart = startHour;
      mergedItem.maintenanceSpanEnd = endHour;
      merged.push(mergedItem);
      skipUntil = lastIndex + 1;
    } else {
      merged.push(item);
    }
  });

  return merged;
}

// ─── 將時間 轉換為分鐘數（用於排序） ───
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}



/* ==========================
   ====== 整個任務群組 ======
   ========================== */

async function loadTasksAndRender() {
  const rows = await loadExcel();
  cachedExcelRows = rows; // 緩存數據供每分鐘刷新使用
  renderAllGroups(rows);
}

// 根據語系 顯示任務區（中：gishiki、shirao、sengen　　日：gishiki、mizuki、shirao）
function getVisibleTaskTypes() {
  if (lang === "zh") {
    return TASK_TYPES.filter(type =>
      ["gishiki", "shirao", "sengen"].includes(type.key)
    );
  }

  // 預設日文
  return TASK_TYPES.filter(type =>
    ["gishiki", "mizuki", "shirao"].includes(type.key)
  );
}

// ─── 所有任務群組（儀式、白青、仙幻島） ───
function renderAllGroups(rows) {
  const container = document.getElementById("taskContainer");

  // taskContainer不存在，直接返回
  if (!container || container.style.display === "none") {
    return;
  }

  // 在清空 container 之前，保存哪些任務類型的「其他時間」是展開的
  const openStates = {};
  getVisibleTaskTypes().forEach(type => {
    const existingGroup = container.querySelector(`.group.${type.key}`);
    if (existingGroup) {
      const remContainer = existingGroup.querySelector('.remainingContainer');
      if (remContainer && remContainer.classList.contains('open')) {
        openStates[type.key] = true;
      }
    }
  });

  container.innerHTML = "";

  const now = getNowBySVR();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();  // 獲取當前分鐘
  const currentDay = now.getDay();

  // 取得今天和明天的星期標籤
  const weekdaysZh = ["日", "一", "二", "三", "四", "五", "六"];
  const todayWeekZh = weekdaysZh[currentDay];
  const tomorrowWeekZh = weekdaysZh[(currentDay + 1) % 7];

  getVisibleTaskTypes().forEach(type => {
    // 步驟 1: 取得今天的任務
    let todayList = getTaskListForWeek(rows, type, todayWeekZh);
    // 步驟 2: 取得明天的任務（用於剩餘任務顯示）
    let tomorrowList = getTaskListForWeek(rows, type, tomorrowWeekZh);
    // 步驟 3: 合併今天和明天的任務（如果有）
    let combinedList = [...todayList];
    if (tomorrowList.length > 0 && currentHour > 20) {
      // 為明天的任務標記日期
      const markedTomorrowList = tomorrowList.map(item => ({
        ...item,
        time: item.time,
        isNextDay: true, // 標記為隔天
        displayTime: item.time // 保留原始顯示時間
      }));
      combinedList = [...todayList, ...markedTomorrowList];
    }

    // 步驟 4: 合併連續維修任務
    combinedList = mergeConsecutiveMaintenance(combinedList);

    // 步驟 5: 分類任務（前一小時、當前、接下來、剩餘、維修判定）
    const { previousItem, currentItem, nextItems, remainingItems, isMaintenance } = categorizeTasksByTime(
      combinedList,
      currentHour
    );

    // 步驟 6: 創建任務群組容器
    const group = document.createElement("div");
    group.className = `group ${type.key}`;

    // 前一小時
    if (lang === "jp" || (lang === "zh" && type.key === "gishiki") && !isMaintenance) {
      const previousRow = createPreviousHourTaskRow(previousItem, currentItem, currentHour, currentMinute);
      group.appendChild(previousRow);
    }

    // 當前小時
    const curRow = createCurrentTaskRow(type, currentItem);
    group.appendChild(curRow);

    // 接下來兩小時 + 剩餘任務
    const wrapper = document.createElement("div");
    wrapper.className = "taskWrapper";

    // 接下來兩小時
    nextItems.forEach(item => {
      wrapper.appendChild(createTaskRow(item, false));
    });

    // 剩餘小時（可收合）
    const remWrapper = document.createElement("div");
    remWrapper.className = "remainingContainer";

    // 如果之前是展開狀態，恢復展開
    if (openStates[type.key]) {
      remWrapper.classList.add('open');
    }

    remainingItems.forEach(item => {
      remWrapper.appendChild(createTaskRow(item, true)); // true = 在剩餘任務區
    });
    wrapper.appendChild(remWrapper);

    // 其他時間按鈕
    const footer = createFooterWithButton(remWrapper, remainingItems, openStates[type.key]);
    wrapper.appendChild(footer);
    group.appendChild(wrapper);

    container.appendChild(group);
  });
}

// ─── 取得指定星期的任務列表 ───
function getTaskListForWeek(rows, type, weekZh) {
  return rows
    .filter(r => r["Week-zh"] === weekZh && r[`${type.key}-time`])
    .map(r => {
      let timeStr = r[`${type.key}-time`];

      // 處理 Excel 數字格式的時間
      if (typeof timeStr === 'number') {
        const hours = Math.floor(timeStr * 24);
        const minutes = Math.floor((timeStr * 24 - hours) * 60);
        timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }

      // 處理 _? 後綴
      let actualTime = String(timeStr || "00:00");
      let hasQuestionMark = false;

      if (actualTime.includes("_?")) {
        hasQuestionMark = true;
        actualTime = actualTime.replace("_?", ""); // 移除 _? 保留純時間
      }

      return {
        // time: String(timeStr || "00:00"),
        time: actualTime,  // 純時間用於排序和比較
        hasQuestionMark: hasQuestionMark,  // 標記是否有 ?
        zh: r[`${type.key}-zh`] || "",
        jp: r[`${type.key}-jp`] || "",
        isNextDay: false // 預設為今天
      };
    })
    .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
}

// ─── 根據時間分類任務 ───
function categorizeTasksByTime(list, currentHour) {
  let currentItem = null;
  let previousItem = null;  // 前半個小時的任務
  const nextItems = [];
  const remainingItemsToday = [];
  const remainingItemsTomorrow = [];   // 隔天 00:00-05:59 的任務

  // 檢查是否在維修時段內
  let maintenanceHours = new Set();

  // 找出所有維修時段的小時（支援合併後的 span）
  list.forEach(item => {
    if (isMaintenanceTask(item)) {
      if (typeof item.maintenanceSpanStart === 'number' && typeof item.maintenanceSpanEnd === 'number') {
        // 展開 span 內的每小時
        for (let h = item.maintenanceSpanStart; h <= item.maintenanceSpanEnd; h++) {
          maintenanceHours.add(h);
        }
      } else {
        const itemHour = parseInt(item.time.split(":")[0]);
        maintenanceHours.add(itemHour);
      }
    }
  });

  // 檢查當前時間是否在維修時段內
  const isInMaintenance = maintenanceHours.has(currentHour);

  // 如果當前時間在維修時段內
  if (isInMaintenance) {
    // 優先使用 Excel 列表中的維修行（若有合併的 span，優先選擇對應 span 的項目）
    let maintenanceItem = list.find(it => {
      if (!isMaintenanceTask(it)) return false;
      if (typeof it.maintenanceSpanStart === 'number' && typeof it.maintenanceSpanEnd === 'number') {
        return currentHour >= it.maintenanceSpanStart && currentHour <= it.maintenanceSpanEnd;
      }
      const itemHour = parseInt((it.time || '').split(':')[0]);
      return itemHour === currentHour;
    });

    // 如果找不到精確匹配，退回到第一筆維修項目（保留 Excel 文本）
    if (!maintenanceItem) {
      maintenanceItem = list.find(it => isMaintenanceTask(it)) || null;
    }

    currentItem = maintenanceItem;

    // 處理接下來兩小時和剩餘任務
    list.forEach(item => {
      const itemHour = parseInt(item.time.split(":")[0]);
      let actualHour = item.isNextDay ? itemHour + 24 : itemHour;

      // 如果不是維修任務，才加入到next或remaining中
      if (!isMaintenanceTask(item)) {
        if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
          nextItems.push(item);
        }
        else if (actualHour > currentHour + 2 && !item.isNextDay && itemHour <= 23) {
          remainingItemsToday.push(item);
        }
        else if (item.isNextDay && itemHour >= 0 && itemHour <= 5 && actualHour > currentHour + 2) {
          remainingItemsTomorrow.push(item);
        }
      }
    });
  } else {    // 如果不在維修時段，使用一般分類邏輯
    // 計算前一個小時（處理跨日：0點時前一小時是23點）
    const previousHour = (currentHour + 23) % 24;
    // 前一個小時的後半段：:30 到 :59
    const halfHourStart = previousHour * 60 + 30;
    const halfHourEnd = previousHour * 60 + 59;

    list.forEach(item => {
      const itemHour = parseInt(item.time.split(":")[0]);
      const itemMinute = parseInt(item.time.split(":")[1]) || 0;
      const itemTotalMinutes = itemHour * 60 + itemMinute;

      let actualHour = item.isNextDay ? itemHour + 24 : itemHour;

      // 前半個小時的任務（不包含維修任務）
      if (!item.isNextDay && !isMaintenanceTask(item)) {
        // 檢查任務時間是否在前一個小時的 :30-:59 範圍內
        if (itemTotalMinutes >= halfHourStart && itemTotalMinutes <= halfHourEnd) {
          previousItem = item;
        }
      }

      if (actualHour === currentHour) {
        currentItem = item;
      }
      // 接下來兩小時
      else if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
        nextItems.push(item);
      }
      // 剩餘任務（今天 23:59 前）
      else if (actualHour > currentHour + 2 && !item.isNextDay && itemHour <= 23) {
        remainingItemsToday.push(item);
      }
      // 隔天凌晨 00:00-05:59 的任務
      else if (item.isNextDay && itemHour >= 0 && itemHour <= 5 && actualHour > currentHour + 2) {
        remainingItemsTomorrow.push(item);
      }
    });
  }

  // 優先使用今天的剩餘任務，如果沒有則使用隔天凌晨的任務
  const remainingItems = remainingItemsToday.length > 0 || currentHour < 21
    ? remainingItemsToday
    : remainingItemsTomorrow;

  return { previousItem, currentItem, nextItems, remainingItems, isInMaintenance };
}


// ─── 前一小時任務 ───
// 顯示條件：有前一個任務 且 (當前時間 < 當前任務時間 OR 沒有當前任務)
function createPreviousHourTaskRow(item, currentItem, currentHour, currentMinute) {
  // 如果沒有前一個任務，返回空元素
  if (!item) {
    return document.createDocumentFragment();
  }

  // 判斷顯示條件：(當前時間 < 當前任務時間) OR (沒有當前任務)
  // 如果有當前任務，檢查時間條件
  if (currentItem) {
    // 獲取當前任務的小時和分鐘
    const timeParts = (currentItem.time || "00:00").split(":");
    const currentItemHour = parseInt(timeParts[0]) || 0;
    const currentItemMinute = parseInt(timeParts[1]) || 0;

    // 計算當前時間和當前任務時間的總分鐘數
    const nowTotalMinutes = currentHour * 60 + currentMinute;
    const taskTotalMinutes = currentItemHour * 60 + currentItemMinute;

    // 如果當前時間 >= 當前任務時間，不顯示前一個任務
    if (nowTotalMinutes >= taskTotalMinutes) {
      return document.createDocumentFragment();
    }
  }
  // 如果沒有當前任務（currentItem 為 null），繼續顯示前一小時任務
  const content = getTaskContent(item);

  // 如果 content 為空，不顯示
  if (!content || content.trim() === "") {
    return document.createDocumentFragment();
  }

  const taskRow = document.createElement("div");
  taskRow.className = "previoushour";

  // 處理時間顯示
  let timeText = item.time || "--:--";
  let questionMark = item.hasQuestionMark ? '[?]' : "";

    const hintText =
    lang === "zh"
      ? "可能還沒死,可以找找看"
      : "未クリアの可能性もあり、<br>探してみよう";

  taskRow.innerHTML = `
    <span class="previoushour_placeholder">${hintText}</span>
    <span class="col-time gray">${timeText}</span>
    <span class="col-questionMark gray">${questionMark}</span>
    <span class="col-content gray">${content}</span>
  `;

  return taskRow;
}

// 當前小時
function createCurrentTaskRow(type, item) {
  const row = document.createElement("div");
  row.className = `taskRow ${type.key} current`;

  let content = item ? getTaskContent(item) : "-------";
  const isMaintenance = item && isMaintenanceTask(item);

  // 處理時間顯示
  let timeText = "";
  let questionMark = "";

  if (!isMaintenance) {
    // 不是維修任務，才顯示時間
    if (item) {
      // 加入 [?] 標記
      if (item.hasQuestionMark) {
        questionMark = '[?]';
      }
      timeText = item.time || "--:--";
    } else {
      timeText = "--:--";
    }
  }
  if (content == "") {
    timeText = "--:--";
    content = "-------";
  }

  const maintenanceClass = isMaintenance ? "maintenance" : "";
  row.innerHTML = `
    <div class="col-type">${lang === "zh" ? type.labelZh : type.labelJp}</div>
    <div class="col-time ${maintenanceClass}">${timeText}</div>
    <div class="col-questionMark">${questionMark}</div>
    <div class="col-content ${maintenanceClass}">${content}</div>
  `;
  console.log("content.length>>>" + timeText + ">" + content.length);

  // 判斷任務是否已過期變灰
  if (item && !isMaintenance) {
    const taskDate = timeStringToDateToday(item.time);
    const now = getNowBySVR();
    const offSetMin = (type === 'gishiki') ? 3 : 5;

    if (taskDate && now.getTime() > taskDate.getTime() + offSetMin * 60000) {
      row.querySelectorAll(".col-time, .col-content").forEach(el => {
        el.classList.add("gray")
      });
    }

  } else if (!item) {
    row.querySelectorAll(".col-time, .col-content").forEach(el =>
      el.classList.add("gray")
    );
  }

  return row;
}

// 創建任務列（接下來兩小時 & 剩餘任務）
function createTaskRow(item, isRemaining = false) {
  const content = getTaskContent(item);

  // 如果 content 為空或只有空白，不顯示這一行
  if (!content || content.trim() === "") {
    return document.createDocumentFragment(); // 回傳空元素
  }

  const taskRow = document.createElement("div");
  taskRow.className = isRemaining ? "taskRow remaining" : "taskRow";

  // 判斷是否為維修中
  const isMaintenance = MAINTENANCE_PATTERN.test(content);
  const maintenanceClass = isMaintenance ? 'maintenance' : '';

  // 處理時間顯示
  let timeText = "";
  let questionMark = "";

  if (!isMaintenance) {
    // 不是維修任務，才顯示時間
    if (item) {
      // 加入 [?] 標記
      if (item.hasQuestionMark) {
        questionMark = '[?]';
      }
      timeText = item.time || "--:--";
    } else {
      timeText = "--:--";
    }
  }

  if (item.isNextDay) {
    const nextDayLabel = lang === "zh" ? "明日" : "翌日";
    tomorrow = `<span class="tomorrow">${nextDayLabel}</span>`;
  } else {
    tomorrow = ``;
  }

  taskRow.innerHTML = `
    <span class="placeholder">${tomorrow}</span>
    <span class="col-time ${maintenanceClass}">${timeText}</span>
    <span class="col-questionMark ${maintenanceClass}">${questionMark}</span>
    <span class="col-content ${maintenanceClass}">${content}</span>
  `;

  console.log("content.length>>>" + timeText + ">" + content.length);

  return taskRow;
}

// 底部按鈕區
function createFooterWithButton(remWrapper, remainingItems, isInitiallyOpen = false) {
  firstWeek
  const footer = document.createElement("div");
  footer.className = "groupFooter";

  // 只有當有剩餘任務時才顯示按鈕
  if (remainingItems.length === 0) {
    return footer; // 沒有剩餘任務，返回空的 footer（不含按鈕）
  }

  const btn = document.createElement("button");
  btn.className = "showBtn";
  // 根據初始狀態設置按鈕文字
  btn.textContent = isInitiallyOpen
    ? (lang === "zh" ? "關閉 ▲" : "閉じる ▲")
    : (lang === "zh" ? "其他時間 ▼" : "その他 ▼");
  btn.type = "button";

  // 按鈕點擊事件：展開/收起剩餘任務
  btn.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();

    const isOpen = remWrapper.classList.contains("open");

    // 關閉所有其他展開的區域
    document.querySelectorAll(".remainingContainer.open").forEach(el => {
      if (el !== remWrapper) {
        el.classList.remove("open");
      }
    });

    // 重置其他按鈕文字
    document.querySelectorAll(".groupFooter .showBtn").forEach(b => {
      if (b !== btn) {
        b.textContent = lang === "zh" ? "其他時間 ▼" : "その他 ▼";
      }
    });

    // 切換當前區域
    if (!isOpen) {
      remWrapper.classList.add("open");
      btn.textContent = lang === "zh" ? "關閉 ▲" : "閉じる ▲";
    } else {
      remWrapper.classList.remove("open");
      btn.textContent = lang === "zh" ? "其他時間 ▼" : "その他 ▼";
    }
  });

  footer.appendChild(btn);
  return footer;
}

// 每小時整點重新載入任務數據
function scheduleHourlyReload() {
  const now = getNowBySVR();
  const msToNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000;

  setTimeout(() => {
    loadTasksAndRender();
    setInterval(loadTasksAndRender, 3600000); // 之後每小時執行一次
  }, msToNextHour);
}

/* ==========================
   ======= 回報區域操作 ======
   ========================== */
const reportTaskTypeEl = document.getElementById("reportTaskType");
const reportTypeEl = document.getElementById("reportType");
const reportCommentEl = document.getElementById("reportComment");
const msgEl = document.getElementById("reportMessage");
const submitReportBtn = document.getElementById("submitReport");
const reportListEl = document.getElementById("reportList");
const clearReportsBtn = document.getElementById("clearReports");

// 取得任務類型標籤
function getTaskTypeLabelSingle(key) {
  const task = REPORTTASK_TYPES.find(t => t.key === key);
  return task ? (lang === "zh" ? task.labelZh : task.labelJp) : key;
}

// 取得回報類型標籤
function getReportTypeLabelSingle(value, taskKey) {
  const types = ["gishiki", "shirao" , "sengentou"].includes(taskKey)
    ? REPORT_TYPES.default
    : REPORT_TYPES.otherOnly;
  const type = types.find(t => t.value === value) || { labelZh: value, labelJp: value };
  return lang === "zh" ? type.labelZh : type.labelJp;
}

// 回報任務說明文字
function updateReportText() {
  let reportText = document.querySelector(".reportText");
  if (!reportText) {
    reportText = document.createElement("div");
    reportText.className = "reportText";
    reportTaskTypeEl.appendChild(reportText);
  }

  const texts = {
    zh:
      "請幫忙填寫儀式或是白青野王的系統提示時間<br>" +
      "有你的幫忙 能讓數據更完善 感謝",
    jp:
      "儀式またはフィールドボスの予兆時間を記入していただけると助かります。<br>" +
      "皆さんのご協力で、データをより正確にすることができます。<br>ありがとうございます！"
  };

  reportText.innerHTML = texts[lang];
}

// 更新回報任務下拉選單
function updateReportTaskOptions() {
  reportTaskTypeEl.innerHTML = "";
  REPORTTASK_TYPES.forEach(task => {
    const opt = document.createElement("option");
    opt.value = task.key;
    opt.textContent = lang === "zh" ? task.labelZh : task.labelJp;
    reportTaskTypeEl.appendChild(opt);
  });
}

// 更新回報類型下拉選單
function updateReportTypeOptions() {
  const selectedTask = reportTaskTypeEl.value;
  const options = ["gishiki", "shirao" , "sengentou"].includes(selectedTask)
    ? REPORT_TYPES.default
    : REPORT_TYPES.otherOnly;

  reportTypeEl.innerHTML = "";
  options.forEach(optData => {
    const opt = document.createElement("option");
    opt.value = optData.value;
    opt.textContent = lang === "zh" ? optData.labelZh : optData.labelJp;
    reportTypeEl.appendChild(opt);
  });
}

// 更新回報備註的提示文字
function updateReportCommentPlaceholder() {
  reportCommentEl.placeholder = lang === "zh" ? "10/15 09:26 地點 / 地點" : "10/15 09:26 場所 / 場所";
  submitReportBtn.textContent = lang === "zh" ? "送出" : "送信";
}

// 監聽任務類型變更，動態更新回報類型選項
reportTaskTypeEl.addEventListener("change", updateReportTypeOptions);

// 初始化回報區域
updateReportText();
updateReportTaskOptions();
updateReportTypeOptions();
updateReportCommentPlaceholder();

// 顯示提示訊息
function showMessage(text, isError = false) {
  msgEl.textContent = text;
  msgEl.style.color = isError ? "red" : "green";
  setTimeout(() => { msgEl.textContent = ""; }, 3000);
}

// 送出回報
submitReportBtn.addEventListener("click", () => {
  const taskType = reportTaskTypeEl.value;
  const reportType = reportTypeEl.value;
  const comment = reportCommentEl.value.trim();

  if (!comment) {
    showMessage(lang === "zh" ? "請輸入內容" : "コメントを入力してください", true);
    return;
  }

  const report = {
    id: Date.now(),
    taskType,
    reportType,
    comment,
    timestamp: new Date().toLocaleString(lang === "zh" ? "zh-TW" : "ja-JP")
  };

  // 儲存到 localStorage
  const reports = JSON.parse(localStorage.getItem(REPORT_STORAGE_KEY) || "[]");
  reports.unshift(report);
  localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(reports));

  // 清空輸入並顯示成功訊息
  reportCommentEl.value = "";
  showMessage(lang === "zh" ? "感謝你" : "ありがとうございました");
  loadReports();
});

// 載入並顯示回報記錄
function loadReports() {
  const reports = JSON.parse(localStorage.getItem(REPORT_STORAGE_KEY) || "[]");
  reportListEl.innerHTML = "";

  reports.forEach(r => {
    const div = document.createElement("div");
    div.className = "reportItem";
    div.innerHTML = `
      [${r.timestamp}] ${getTaskTypeLabelSingle(r.taskType)} ${getReportTypeLabelSingle(r.reportType, r.taskType)} ${r.comment}`;
    reportListEl.appendChild(div);
  });
}

// 清除所有回報記錄
clearReportsBtn.addEventListener("click", () => {
  localStorage.removeItem(REPORT_STORAGE_KEY);
  loadReports();
});

/* ==========================
   ======= 管理者Key ======
   ========================== */
document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const key = params.get("key");

  // 如果 key 符合指定值，顯示按鈕
  if (key === "tp6ao354") {
    const secretButton = document.getElementById("clearReports");
    if (secretButton) {
      secretButton.style.display = "inline-block";
    }
  }
});

/* ==========================
   ======= 初始化流程 ======
   ========================== */

// 步驟 1: 偵測並設定語系
detectLangByTimezone();

// 步驟 2: 更新必定顯示的內容（header 時間）
updateTopTime();

// 步驟 3: 根據期間判斷要執行什麼
if (isInDateRange()) {
  // ③ 期間內：只顯示 firstWeek
  initInDateRange();
} else {
  // ② 期間外：顯示完整任務表
  initOutDateRange();
}

// 步驟 4: 初始化回報區（期間內外都需要）
// renderEventBlock();
updateReportText();
updateReportTaskOptions();
updateReportTypeOptions();
updateReportCommentPlaceholder();
loadReports();

// 步驟 5: 每小時更新一次所有內容
setInterval(() => {
  console.log("e/ vup ");
  updateTopTime();

  if (isInDateRange()) {
    initInDateRange();
  } else {
    initOutDateRange();
  }
}, 3600000); // 3600000 毫秒 = 1 小時

// 每秒更新時間顯示
setInterval(updateTopTime, 1000);



// /* ==========================
//    ====== 特別活動 ======
//    ========================== */

// /* ─── 事件樣式更新 Timer 管理 ─── */
// let eventStyleIntervalId = null;

// /* ─── 特別活動區塊（標題 + 時間） ─── */
// function renderEventBlock() {
//   const eventEl = document.getElementById('event');
//   if (!eventEl) return;

//   // 活動時間定義
//   const times = ['16:00', '19:00', '22:00', '01:00'];

//   // 清空原內容
//   eventEl.innerHTML = '';

//   // ─── 標題 ───
//   const titleDiv = document.createElement('div');
//   titleDiv.className = 'eventTitle';

//   const texts = {
//     zh: '星河的懸賞通緝令',
//     jp: 'ボスラッシュシーズン2'
//   };
//   titleDiv.innerHTML = texts[lang];
//   eventEl.appendChild(titleDiv);

//   // ─── 時間列表 ───
//   const timeWrapper = document.createElement('div');
//   timeWrapper.id = 'eventTime';

//   times.forEach(t => {
//     // 時間解析
//     const hourClass = t.split(':')[0];
//     const hourValue = parseInt(hourClass, 10);

//     const d = document.createElement('div');
//     d.className = `event ${hourClass} has-checkbox`;

//     // 通知 checkbox（預設隱藏）
//     const checkbox = document.createElement('input');
//     checkbox.type = 'checkbox';
//     checkbox.id = `notify-${hourValue}`;
//     checkbox.value = hourValue;
//     checkbox.className = 'notify-checkbox';

//     d.appendChild(checkbox);
//     d.appendChild(document.createTextNode(t));
//     timeWrapper.appendChild(d);
//   });

//   eventEl.appendChild(timeWrapper);

//   // ─── 初次樣式更新與 Timer 管理 ───
//   updateEventStyles();
//   if (eventStyleIntervalId) clearInterval(eventStyleIntervalId);
//   eventStyleIntervalId = setInterval(updateEventStyles, 60000);
// }

// /* ─── 依時間更新活動樣式 ─── */
// function updateEventStyles() {
//   const wrapper = document.getElementById('eventTime');
//   if (!wrapper) return;

//   const now = getNowBySVR();
//   const currentMinutes = now.getHours() * 60 + now.getMinutes();

//   Array.from(wrapper.children).forEach(div => {
//     // 重置樣式
//     div.classList.remove('time-light', 'time-deep', 'time-alert', 'fade-animation');
//     div.style.color = '';

//     const text = div.textContent.trim();
//     if (!text) return;

//     // 事件時間解析
//     const [hStr, mStr] = text.split(':');
//     const eventMinutes = parseInt(hStr, 10) * 60 + (parseInt(mStr, 10) || 0);

//     let diff = eventMinutes - currentMinutes;
//     if (diff < 0) diff += 1440;

//     // 時間區間判定
//     if (diff > 60) {
//       div.classList.add('time-light');
//     } else if (diff > 15) {
//       div.classList.add('time-deep');
//     } else if (diff >= 0) {
//       div.classList.add('time-alert', 'fade-animation');
//     } else {
//       div.classList.add('time-light');
//     }
//   });
// }

// /* ==========================
//    ====== 通知功能（設定 & UI） ======
//    ========================== */

// const NOTIFICATION_STORAGE_KEY = 'bossRushNotifications';
// const EVENT_TIMES = [16, 19, 22, 1];

// /* ─── 通知設定存取 ─── */
// function getNotificationSettings() {
//   return JSON.parse(localStorage.getItem(NOTIFICATION_STORAGE_KEY)) || {
//     enabled: false,
//     selectedTimes: [],
//     notifyBefore: 30,
//     lastNotified: {}
//   };
// }

// function saveNotificationSettings(settings) {
//   localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(settings));
// }

// /* ─── 包裝原 renderEventBlock 加入通知 UI ─── */
// const originalRenderEventBlock = renderEventBlock;
// renderEventBlock = function () {
//   originalRenderEventBlock();

//   if (lang !== 'zh') return;

//   const eventEl = document.getElementById('event');
//   if (!eventEl) return;

//   const settings = getNotificationSettings();

//   // ─── 標題 + 鈴鐺包裝 ───
//   const wrapper = document.createElement('div');
//   wrapper.className = 'notificationWrapper';

//   const titleDiv = eventEl.querySelector('.eventTitle');

//   const bellButton = document.createElement('button');
//   bellButton.className = 'bellButton';
//   bellButton.id = 'bellButton';
//   bellButton.innerHTML =
//     `<img src="images/bell-${settings.enabled ? 'on' : 'off'}01.svg">`;

//   if (titleDiv) {
//     wrapper.appendChild(titleDiv);
//     wrapper.appendChild(bellButton);
//     eventEl.insertBefore(wrapper, eventEl.firstChild);
//   }

//   // ─── 通知設定面板 ───
//   const panel = createNotificationPanel(settings);
//   const eventTime = document.getElementById('eventTime');
//   if (eventTime) eventEl.insertBefore(panel, eventTime.nextSibling);

//   bellButton.addEventListener('click', toggleNotificationPanel);
// };

// /* ─── 建立通知設定面板 ─── */
// function createNotificationPanel(settings) {
//   const panel = document.createElement('div');
//   panel.className = 'notificationPanel';
//   panel.id = 'notificationPanel';

//   // 控制區
//   const controlsDiv = document.createElement('div');
//   controlsDiv.className = 'notificationControls';

//   const select = document.createElement('select');
//   select.id = 'notifyBeforeSelect';

//   [45, 30, 15].forEach(m => {
//     const option = document.createElement('option');
//     option.value = m;
//     option.textContent = `${m}分鐘前`;
//     if (settings.notifyBefore === m) option.selected = true;
//     select.appendChild(option);
//   });

//   controlsDiv.appendChild(select);

//   // 按鈕群組
//   const buttonsDiv = document.createElement('div');
//   buttonsDiv.className = 'notificationButtons';

//   const testButton = document.createElement('button');
//   testButton.textContent = '測試';
//   testButton.onclick = testNotification;

//   const clearButton = document.createElement('button');
//   clearButton.textContent = '清除';
//   clearButton.onclick = clearNotificationConfig;

//   const saveButton = document.createElement('button');
//   saveButton.textContent = '保存';
//   saveButton.onclick = saveNotificationConfig;

//   buttonsDiv.append(testButton, clearButton, saveButton);
//   controlsDiv.appendChild(buttonsDiv);
//   panel.appendChild(controlsDiv);

//   // 訊息區
//   const messageDiv = document.createElement('div');
//   messageDiv.id = 'testMessage';
//   messageDiv.className = 'testMessage';
//   panel.appendChild(messageDiv);

//   return panel;
// }

// /* ==========================
//    ====== 通知排程與播放 ======
//    ========================== */

// /* ─── 播放通知 ─── */
// function playNotification() {
//   try {
//     new Audio('files/notification.mp3').play().catch(() => {});
//     if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
//   } catch (err) {
//     console.error(err);
//   }
// }

// /* ─── 檢查是否需要通知 ─── */
// function checkAndNotify() {
//   const settings = getNotificationSettings();
//   if (!settings.enabled || !settings.selectedTimes.length) return;

//   const now = getNowBySVR();
//   const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

//   settings.selectedTimes.forEach(eventHour => {
//     const eventTotalMinutes = eventHour * 60;
//     const start = eventTotalMinutes - settings.notifyBefore;
//     const end = eventTotalMinutes - 10;

//     if (currentTotalMinutes < start || currentTotalMinutes > end) return;
//     if ((currentTotalMinutes - start) % 10 !== 0) return;

//     const key = `${now.toISOString().slice(0, 10)}-${currentTotalMinutes}`;
//     if (settings.lastNotified[key]) return;

//     playNotification();
//     settings.lastNotified[key] = true;
//     saveNotificationSettings(settings);
//   });
// }

// setInterval(checkAndNotify, 60000);
// checkAndNotify();