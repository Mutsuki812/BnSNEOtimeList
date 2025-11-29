/* ==========================
   ====== 設定 & 資料 ======
   ========================== */
const EXCEL_URL = "./files/timeList.xlsx";
const SHEET_NAME = "timeList";
const SHEET_JP = "timeList_JP";
const SHEET_TW = "timeList_TW";

const TASK_TYPES = [
  { key: "gishiki", labelZh: "可疑的儀式", labelJp: "怪しい儀式", color: "#7a4171", offsetMin: 10 },
  { key: "mizuki", labelZh: "水月野王", labelJp: "水月FB", color: "#1e50a2", offsetMin: 5 },
  { key: "shirao", labelZh: "白青野王", labelJp: "白青FB", color: "#7b8d42", offsetMin: 5 },
];

const REPORTTASK_TYPES = [
  { key: "gishiki", labelZh: "可疑的儀式", labelJp: "怪しい儀式" },
  { key: "mizuki", labelZh: "水月野王", labelJp: "水月FB" },
  { key: "shirao", labelZh: "白青野王", labelJp: "白青FB" },
  { key: "other", labelZh: "其他", labelJp: "その他" },
];

const REPORT_TYPES = {
  default: [
    { value: "date_report", labelZh: "時間回報", labelJp: "時間報告" },
    { value: "other", labelZh: "其他", labelJp: "その他" },
  ],
  otherOnly: [
    { value: "other", labelZh: "其他", labelJp: "その他" },
  ]
};

// 每一季的第一周時間
const dateRanges = {
  zh: {
    start: new Date('2025-11-12T11:00:00+08:00'), // 台灣時間 10/15 11:00
    end: new Date('2025-11-19T05:59:59+08:00')     // 台灣時間 10/22 06:00

  },
  jp: {
    start: new Date('2025-11-12T10:00:00+09:00'), // 日本時間 10/15 10:00
    end: new Date('2025-11-19T05:59:59+09:00')     // 日本時間 10/22 06:00
  }
};

const REPORT_STORAGE_KEY = "myReports";

// 維修任務的匹配模式
const MAINTENANCE_PATTERN = /例行維護中|定期メンテナンス中/;

/* ==========================
   ====== 語系判定 & 切換 ======
   ========================== */
let lang = "zh";

// 更新HTML的語系標記
function updateHtmlLang() {
  document.documentElement.setAttribute('lang', lang);
}

// interval id for updating event styles
let eventStyleIntervalId = null;

// Excel 數據緩存和刷新控制
let cachedExcelRows = null;           // 緩存的 Excel 數據
let minuteRefreshIntervalId = null;   // 每分鐘刷新任務列表的定時器 ID

// 根據時區自動判定語系
function detectLangByTimezone() {
  // 先檢查是否有儲存的語言偏好
  const savedLang = localStorage.getItem('userLang');

  if (savedLang) {
    // 如果有儲存的語言，使用儲存的設定
    lang = savedLang;
  } else {
    // 第一次訪問，根據時區判定
    const timezoneOffset = -new Date().getTimezoneOffset() / 60;
    lang = timezoneOffset === 9 ? "jp" : "zh";
  }

  updateLangButtonText();
}

// 更新語系切換按鈕文字
function updateLangButtonText() {
  document.getElementById("langBtn").textContent = lang === "zh" ? "日本鯖切替" : "切換到台服";
}

// 語系切換按鈕事件
document.getElementById("langBtn").addEventListener("click", () => {
  lang = lang === "zh" ? "jp" : "zh";

  // 儲存使用者的語言選擇
  localStorage.setItem('userLang', lang);

  // 更新按鈕文字
  updateLangButtonText();

  // 更新HTML語系標記
  updateHtmlLang();
  // updateEventTitle();
  // renderEventBlock();

  // 更新時間顯示
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
   ====== 時間處理 ======
   ========================== */
// 根據當前語系取得對應時區的時間
function getNowBySVR() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const offset = (lang === "zh" ? 8 : 9) * 60 * 60000;
  return new Date(utc + offset);
}

// 格式化日期標籤（年/月/日（星期））
function formatDateLabel(d) {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = {
    zh: ["日", "一", "二", "三", "四", "五", "六"],
    jp: ["日", "月", "火", "水", "木", "金", "土"]
  };
  const weekday = weekdays[lang][d.getDay()];
  return `${year}/${month}/${day}（${weekday}）`;
}

// 更新頁面頂部的時間顯示
function updateTopTime() {
  const now = getNowBySVR();
  document.getElementById("dateLabel").textContent = formatDateLabel(now);

  const locale = lang === "zh" ? "zh-TW" : "ja-JP";
  const options = { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
  const timeStr = now.toLocaleTimeString(locale, options);

  document.getElementById("timeBox").innerHTML = `
    <span class="timeLabel">${lang === "zh" ? "台灣時間" : "日本時間"}</span>
    <span class="timeValue">${timeStr}</span>
  `;
}

// 將時間字串（HH:MM）轉換為今天的 Date 物件
function timeStringToDateToday(timeStr) {
  const now = getNowBySVR();
  const [h, m] = (timeStr || "--:--").split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
}

/* ==========================
   ====== 當前日期是否為每一季的第一周 ======
   ========================== */
// 判斷當前是否在特定時間範圍內
function isInDateRange() {
  const now = getNowBySVR(); // 取得對應時區的當前時間
  const range = dateRanges[lang]; // 根據當前語系取得對應的時間範圍

  return now >= range.start && now <= range.end;
}

/* ==========================
   ====== 期間內初始化 ======
   ========================== */
function initInDateRange() {
  // 顯示 noDate
  updateNoDateText();
  const noDateDiv = document.getElementById("noDate");
  if (noDateDiv) noDateDiv.style.display = "block";

  // 顯示 langText
  updateLangText();
  const langTextDiv = document.getElementById("langText");
  if (langTextDiv) langTextDiv.style.display = "block";

  // 顯示 taskContainer 並載入資料
  const taskContainerDiv = document.getElementById("taskContainer");
  if (taskContainerDiv) {
    taskContainerDiv.style.display = "block";
    loadTasksAndRender(); // 載入 Excel 並渲染任務

    // 啟動每分鐘刷新任務列表 UI（使用緩存數據）
    if (minuteRefreshIntervalId) {
      clearInterval(minuteRefreshIntervalId);
    }
    minuteRefreshIntervalId = setInterval(() => {
      if (cachedExcelRows) {
        renderAllGroups(cachedExcelRows); // 使用緩存數據刷新 UI
      }
    }, 60000); // 每1分鐘（60,000 毫秒）
  }
}

/* ==========================
   ====== 期間外初始化 ======
   ========================== */
function initOutDateRange() {
  // 隱藏 noDate
  const noDateDiv = document.getElementById("noDate");
  if (noDateDiv) noDateDiv.style.display = "none";

  // 顯示 langText
  updateLangText();
  const langTextDiv = document.getElementById("langText");
  if (langTextDiv) langTextDiv.style.display = "block";

  // 顯示 taskContainer 並載入資料
  const taskContainerDiv = document.getElementById("taskContainer");
  if (taskContainerDiv) {
    taskContainerDiv.style.display = "block";
    loadTasksAndRender(); // 載入 Excel 並渲染任務

    // 啟動每分鐘刷新任務列表 UI（使用緩存數據）
    if (minuteRefreshIntervalId) {
      clearInterval(minuteRefreshIntervalId);
    }
    minuteRefreshIntervalId = setInterval(() => {
      if (cachedExcelRows) {
        renderAllGroups(cachedExcelRows); // 使用緩存數據刷新 UI
      }
    }, 60000); // 每1分鐘（60,000 毫秒）
  }
}

/* ==========================
   ====== 說明文字 ======
   ========================== */
function updateLangText() {
  let langTextDiv = document.getElementById("langText");
  if (!langTextDiv) {
    langTextDiv = document.createElement("div");
    langTextDiv.id = "langText";
    langTextDiv.className = "langText";
    document.body.appendChild(langTextDiv);
  }
  const texts = {
    zh: "<b>白青山脈Ｓ３　2025.11.12 - 2025.12.17</b><br>" +
      "・表記時間 = 系統出字時間<br>" +
      "・出字提示後５分鐘Boss登場。<br>" +
      "・時間有[?]，是路上不小心遇到，不是系統出字時間。<br>" +
      "　若有更準確的時間資訊，歡迎補充！<br>",
    jp: "<b>白青シーズン３　2025.11.12 - 2025.12.17</b><br>" +
      "・表の時間 ＝ システムが予兆文字を表示した時間<br>" +
      "・予兆後、５分でボスが出現します。<br>" +
      "・時間に[？]が付いている場合は、<br>" +
      "　ボスが散歩中に発見、予兆時間ではない。<br>" +
      "　もしより詳しい時間が分かれば、ぜひご提供ください。<br>"
  };
  langTextDiv.innerHTML = texts[lang];
}

// 沒有數據時的任務表
function updateNoDateText() {
  let noDateDiv = document.getElementById("noDate");
  if (!noDateDiv) {
    noDateDiv = document.createElement("div");
    noDateDiv.id = "noDate";

    const mainCard = document.getElementById("mainCard");
    if (mainCard) {
      mainCard.appendChild(noDateDiv);
    }
  }
  const texts = {
    zh: "新開始的第一周 暫無數據<br>" +
      "請各位大俠幫幫忙",
    jp: "新シーズンが始まったばかりのため、まだデータがありません。<br>" +
      "情報提供のご協力をよろしくお願いします！"
  };
  noDateDiv.innerHTML = texts[lang];
}

/* ==========================
   ====== Excel 讀取 ======
   ========================== */
async function loadExcel() {
  try {
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
   ====== 任務處理輔助函數 ======
   ========================== */
// 檢查任務項是否為[維修]
function isMaintenanceTask(item) {
  if (!item) return false;
  const content = lang === "zh" ? item.zh : item.jp;
  return MAINTENANCE_PATTERN.test(content);
}

// 取得任務內容（根據當前語系）
function getTaskContent(item) {
  return lang === "zh" ? item.zh : item.jp;
}

// 合併連續的相同維修任務
function mergeConsecutiveMaintenance(list) {
  const merged = [];
  let skipUntil = -1;

  list.forEach((item, index) => {
    // 跳過已處理的連續項目
    if (index < skipUntil) return;

    const content = getTaskContent(item);
    const isMaintenance = MAINTENANCE_PATTERN.test(content);

    if (isMaintenance) {
      // 找出連續相同的維修項目並記錄時間範圍（start/end）
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

// 將時間字串轉換為分鐘數（用於排序）
function timeToMinutes(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + (minutes || 0);
}

/* ==========================
   ====== 整個任務區任務 ======
   ========================== */
async function loadTasksAndRender() {
  const rows = await loadExcel();
  cachedExcelRows = rows; // 緩存數據供每分鐘刷新使用
  renderAllGroups(rows);
}

// 所有任務群組（儀式、水月、白青）
function renderAllGroups(rows) {
  const container = document.getElementById("taskContainer");

  // taskContainer不存在，直接返回
  if (!container || container.style.display === "none") {
    return;
  }

  // 在清空 container 之前，保存哪些任務類型的「其他時間」是展開的
  const openStates = {};
  TASK_TYPES.forEach(type => {
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

  TASK_TYPES.forEach(type => {
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

    // === 渲染前一小時任務（僅日文介面 + 非維修時段顯示）===
    if (lang === "jp" && !isMaintenance) {
      const previousRow = createPreviousHourTaskRow(previousItem, currentItem, currentHour, currentMinute);
      group.appendChild(previousRow);
    }

    // === 渲染當前任務 ===
    const curRow = createCurrentTaskRow(type, currentItem);
    group.appendChild(curRow);

    // === 渲染接下來兩小時 + 剩餘任務 ===
    const wrapper = document.createElement("div");
    wrapper.className = "taskWrapper";

    // 接下來兩小時
    nextItems.forEach(item => {
      wrapper.appendChild(createTaskRow(item, false));
    });

    // 剩餘任務（可收合）
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

// === 取得指定星期的任務列表 ===
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

// === 根據時間分類任務 ===
function categorizeTasksByTime(list, currentHour) {
  let currentItem = null;
  let previousItem = null;  // 前一個小時的任務
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
  } else {
    // 如果不在維修時段，使用一般分類邏輯
    // 計算前一個小時（處理跨日：0點時前一小時是23點）
    const previousHour = (currentHour + 23) % 24;

    list.forEach(item => {
      const itemHour = parseInt(item.time.split(":")[0]);
      let actualHour = item.isNextDay ? itemHour + 24 : itemHour;

      // 前一個小時的任務（不包含維修任務）
      if (itemHour === previousHour && !item.isNextDay && !isMaintenanceTask(item)) {
        previousItem = item;
      }
      else if (actualHour === currentHour) {
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


// 創建前一小時任務列
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
  taskRow.className = "previoushour";  // 使用 previoushour class

  // 處理時間顯示
  let timeText = item.time || "--:--";
  let questionMark = "";

  if (item.hasQuestionMark) {
    questionMark = '[?]';
  }

  taskRow.innerHTML = `
    <span class="previoushour_placeholder">未クリアの可能性があり、探してみよう</span>
    <span class="col-time gray">${timeText}</span>
    <span class="col-questionMark gray">${questionMark}</span>
    <span class="col-content gray">${content}</span>
  `;

  return taskRow;
}


// 創建當前任務列
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

    if (taskDate && now.getTime() > taskDate.getTime() + type.offsetMin * 60000) {
      row.querySelectorAll(".col-time, .col-content").forEach(el => {

        el.classList.add("gray")

        if (type.key == "gishiki") {
          console.log("gishiki>>>");
          if (content.length == 11) {
            console.log("long11");
            el.classList.add('long11');
          }
          if (content.length == 12) {
            console.log("long12");
            el.classList.add('long12');
          }
          if (content.length == 13) {
            console.log("long13");
            el.classList.add('long13');
          }
        }
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

  if (!isMaintenance) {
    if (content.length == 11) {
      taskRow.querySelector('.col-content').classList.add('long11');
      console.log("long11");
    }

    if (content.length == 12) {
      taskRow.querySelector('.col-content').classList.add('long12');
      console.log("long12");
    }

    if (content.length == 13) {
      taskRow.querySelector('.col-content').classList.add('long13');
      console.log("long13");
    }
  }

  return taskRow;
}

// 底部按鈕區
function createFooterWithButton(remWrapper, remainingItems, isInitiallyOpen = false) {
  noDate
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
   ====== 回報區域操作 ======
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
  const types = ["gishiki", "mizuki", "shirao"].includes(taskKey)
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
  const options = ["gishiki", "mizuki", "shirao"].includes(selectedTask)
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
  reportCommentEl.placeholder = lang === "zh" ? "10/15 19:26 地點 / 地點" : "10/15 19:26 場所 / 場所";
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
   ====== 管理者Key ======
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
   ====== 初始化流程 ======
   ========================== */

// 步驟 1: 偵測並設定語系
detectLangByTimezone();

// 步驟 2: 更新必定顯示的內容（header 時間）
updateTopTime();

// 步驟 3: 根據期間判斷要執行什麼
if (isInDateRange()) {
  // ③ 期間內：只顯示 noDate
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
// // 動態產生特別活動區塊（title + times）
// function renderEventBlock() {
//   const eventEl = document.getElementById('event');
//   if (!eventEl) return;

//   // 時間陣列：若你想從設定或檔案讀取，可改成變數來源
//   const times = ['16:00', '19:00', '22:00', '01:00'];

//   // 清空並建立新的內容
//   eventEl.innerHTML = '';

//   const titleDiv = document.createElement('div');
//   titleDiv.className = 'eventTitle';
//   // 直接使用 updateEv3ntTitle 可讓語系一致
//   const texts = { zh: '星河的懸賞通緝令', jp: 'ボスラッシュシーズン2' };
//   titleDiv.innerHTML = texts[lang];
//   eventEl.appendChild(titleDiv);

//   const timeWrapper = document.createElement('div');
//   timeWrapper.id = 'eventTime';
//   times.forEach(t => {
//     const hourClass = t.split(':')[0];
//     const hourValue = parseInt(hourClass, 10); // 轉為數字以匹配 EVENT_TIMES
//     const d = document.createElement('div');
//     // 保留原本的 class 格式（例如: "event 16"）並添加 has-checkbox
//     d.className = `event ${hourClass} has-checkbox`;

//     // 創建 checkbox (預設隱藏，點擊鈴鐺後才顯示)
//     const checkbox = document.createElement('input');
//     checkbox.type = 'checkbox';
//     checkbox.id = `notify-${hourValue}`; // 使用數字ID以匹配 EVENT_TIMES
//     checkbox.value = hourValue;
//     checkbox.className = 'notify-checkbox';

//     // 創建時間文字節點
//     const timeText = document.createTextNode(t);

//     d.appendChild(checkbox);
//     d.appendChild(timeText);
//     timeWrapper.appendChild(d);
//   });
//   eventEl.appendChild(timeWrapper);

//   // 初次建立後立即套用樣式，並啟動定時器定期更新（避免建立多個 timer）
//   updateEventStyles();
//   if (eventStyleIntervalId) {
//     clearInterval(eventStyleIntervalId);
//   }
//   // 每 1分鐘更新一次，以便在 15 分鐘倒數期間動畫與顏色能及時顯示
//   eventStyleIntervalId = setInterval(updateEventStyles, 60000);
// }

// // 更新 event 時間塊的樣式（淺灰 / 深灰 / 紅色 + 動畫）
// function updateEventStyles() {
//   const wrapper = document.getElementById('eventTime');
//   if (!wrapper) return;

//   const now = getNowBySVR();
//   const currentMinutes = now.getHours() * 60 + now.getMinutes();

//   Array.from(wrapper.children).forEach(div => {
//     // 移除先前的樣式
//     div.classList.remove('time-light', 'time-deep', 'time-alert', 'fade-animation');
//     div.style.color = '';

//     const text = div.textContent.trim();
//     if (!text) return;

//     const [hStr, mStr] = text.split(':');
//     const h = parseInt(hStr, 10);
//     const m = parseInt(mStr, 10) || 0;
//     const eventMinutes = h * 60 + m;

//     // 差距（分鐘）
//     let diff = eventMinutes - currentMinutes;
//     if (diff < 0) diff += 24 * 60; // 如果已過該時刻，就視為隔天同時段（不跨日但重複循環）

//     // 條件判定（Case1～4）
//     if (diff > 60) {
//       // 距離事件超過1小時：淺灰
//       div.classList.add("time-light");
//     } else if (diff > 15) {
//       // 1小時內但超過15分鐘：深灰
//       div.classList.add("time-deep");
//     } else if (diff >= 0) {
//       // 15分鐘內：紅色 + 跳動
//       div.classList.add("time-alert", "fade-animation");
//     } else {
//       // 已過 → 淺灰
//       div.classList.add("time-light");
//     }
//   });
// }


// /* ==========================
//    ====== 特別活動 通知功能 ======
//    ========================== */

// const NOTIFICATION_STORAGE_KEY = "bossRushNotifications";
// const EVENT_TIMES = [16, 19, 22, 1]; // Boss Rush 時間（小時）

// // 取得通知設定
// function getNotificationSettings() {
//   const stored = localStorage.getItem(NOTIFICATION_STORAGE_KEY);
//   if (stored) {
//     return JSON.parse(stored);
//   }
//   return {
//     enabled: false,
//     selectedTimes: [],
//     notifyBefore: 30,
//     lastNotified: {}
//   };
// }

// // 儲存通知設定
// function saveNotificationSettings(settings) {
//   localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify(settings));
// }

// // 修改 renderEventBlock 函數以加入鈴鐺按鈕和通知面板
// const originalRenderEventBlock = renderEventBlock;
// renderEventBlock = function () {
//   originalRenderEventBlock();

//   // 只在中文介面顯示通知功能
//   if (lang !== 'zh') return;

//   const eventEl = document.getElementById('event');
//   if (!eventEl) return;

//   const settings = getNotificationSettings();

//   // 創建包裝容器
//   const wrapper = document.createElement('div');
//   wrapper.className = 'notificationWrapper';

//   // 取得已有的 titleDiv
//   const titleDiv = eventEl.querySelector('.eventTitle');

//   // 創建鈴鐺按鈕
//   const bellButton = document.createElement('button');
//   bellButton.className = 'bellButton';
//   bellButton.id = 'bellButton';
//   bellButton.innerHTML = `<img src="images/bell-${settings.enabled ? 'on' : 'off'}01.svg" alt="通知">`;

//   // 將 titleDiv 和 bellContainer 包裝
//   if (titleDiv) {
//     wrapper.appendChild(titleDiv);
//     wrapper.appendChild(bellButton);
//     eventEl.insertBefore(wrapper, eventEl.firstChild);
//   }

//   // 創建通知設定面板（放在時間列表後面）
//   const panel = createNotificationPanel(settings);
//   const eventTime = document.getElementById('eventTime');
//   if (eventTime) {
//     // 將面板插入到時間列表之後
//     if (eventTime.nextSibling) {
//       eventEl.insertBefore(panel, eventTime.nextSibling);
//     } else {
//       eventEl.appendChild(panel);
//     }
//   }

//   // 綁定鈴鐺按鈕點擊事件
//   bellButton.addEventListener('click', toggleNotificationPanel);
// };

// // 創建通知設定面板
// function createNotificationPanel(settings) {
//   const panel = document.createElement('div');
//   panel.className = 'notificationPanel';
//   panel.id = 'notificationPanel';

//   // 控制區（下拉選單 + 按鈕）
//   const controlsDiv = document.createElement('div');
//   controlsDiv.className = 'notificationControls';

//   // 提前通知下拉選單
//   const selectWrapper = document.createElement('div');
//   const selectLabel = document.createElement('label');
//   selectLabel.textContent = '提前通知：';
//   const select = document.createElement('select');
//   select.id = 'notifyBeforeSelect';

//   [45, 30, 15].forEach(minutes => {
//     const option = document.createElement('option');
//     option.value = minutes;
//     option.textContent = `${minutes}分鐘前`;
//     if (settings.notifyBefore === minutes) {
//       option.selected = true;
//     }
//     select.appendChild(option);
//   });

//   selectWrapper.appendChild(selectLabel);
//   selectWrapper.appendChild(select);
//   controlsDiv.appendChild(selectWrapper);

//   // 按鈕群組
//   const buttonsDiv = document.createElement('div');
//   buttonsDiv.className = 'notificationButtons';

//   const testButton = document.createElement('button');
//   testButton.className = 'testButton';
//   testButton.textContent = '測試';
//   testButton.addEventListener('click', testNotification);

//   const clearButton = document.createElement('button');
//   clearButton.textContent = '清除';
//   clearButton.addEventListener('click', clearNotificationConfig);

//   const saveButton = document.createElement('button');
//   saveButton.textContent = '保存';
//   saveButton.addEventListener('click', saveNotificationConfig);

//   buttonsDiv.appendChild(testButton);
//   buttonsDiv.appendChild(clearButton);
//   buttonsDiv.appendChild(saveButton);
//   controlsDiv.appendChild(buttonsDiv);

//   panel.appendChild(controlsDiv);

//   // 測試訊息區
//   const messageDiv = document.createElement('div');
//   messageDiv.className = 'testMessage';
//   messageDiv.id = 'testMessage';
//   panel.appendChild(messageDiv);

//   return panel;
// }

// // 切換通知面板顯示/隱藏
// function toggleNotificationPanel() {
//   const panel = document.getElementById('notificationPanel');
//   const eventTime = document.getElementById('eventTime');
//   const settings = getNotificationSettings();

//   if (panel.classList.contains('active')) {
//     // 關閉面板，隱藏 checkbox
//     panel.classList.remove('active');
//     if (eventTime) {
//       eventTime.classList.remove('show-checkboxes');
//     }
//   } else {
//     // 開啟面板，顯示 checkbox 並恢復選中狀態
//     panel.classList.add('active');
//     if (eventTime) {
//       eventTime.classList.add('show-checkboxes');
//       // 恢復之前保存的選中狀態
//       EVENT_TIMES.forEach(hour => {
//         const checkbox = document.getElementById(`notify-${hour}`);
//         if (checkbox) {
//           checkbox.checked = settings.selectedTimes.includes(hour);
//         }
//       });
//     }
//   }
// }

// // 保存通知設定
// function saveNotificationConfig() {
//   const selectedTimes = [];
//   EVENT_TIMES.forEach(hour => {
//     const checkbox = document.getElementById(`notify-${hour}`);
//     if (checkbox && checkbox.checked) {
//       selectedTimes.push(hour);
//     }
//   });

//   const notifyBefore = parseInt(document.getElementById('notifyBeforeSelect').value);

//   const settings = {
//     enabled: selectedTimes.length > 0,
//     selectedTimes: selectedTimes,
//     notifyBefore: notifyBefore,
//     lastNotified: getNotificationSettings().lastNotified || {}
//   };

//   saveNotificationSettings(settings);

//   // 更新鈴鐺圖示
//   const button = document.getElementById('bellButton');
//   if (button) {
//     button.innerHTML = `<img src="images/bell-${settings.enabled ? 'on' : 'off'}01.svg" alt="通知">`;
//   }

//   // 關閉面板並隱藏 checkbox
//   const panel = document.getElementById('notificationPanel');
//   const eventTime = document.getElementById('eventTime');
//   if (panel) {
//     panel.classList.remove('active');
//   }
//   if (eventTime) {
//     eventTime.classList.remove('show-checkboxes');
//   }

//   // 顯示保存成功訊息
//   const messageDiv = document.getElementById('testMessage');
//   if (messageDiv) {
//     messageDiv.textContent = '設定已保存！';
//     messageDiv.className = 'testMessage';
//     setTimeout(() => {
//       messageDiv.textContent = '';
//     }, 3000);
//   }
// }

// // 清除通知設定
// function clearNotificationConfig() {
//   // 取消所有 checkbox
//   EVENT_TIMES.forEach(hour => {
//     const checkbox = document.getElementById(`notify-${hour}`);
//     if (checkbox) {
//       checkbox.checked = false;
//     }
//   });

//   // 清除保存的設定
//   const settings = {
//     enabled: false,
//     selectedTimes: [],
//     notifyBefore: 30,
//     lastNotified: {}
//   };

//   saveNotificationSettings(settings);

//   // 更新鈴鐺圖示
//   const button = document.getElementById('bellButton');
//   if (button) {
//     button.innerHTML = `<img src="images/bell-off01.svg" alt="通知">`;
//   }

//   // 顯示清除成功訊息
//   const messageDiv = document.getElementById('testMessage');
//   if (messageDiv) {
//     messageDiv.textContent = '設定已清除！';
//     messageDiv.className = 'testMessage';
//     setTimeout(() => {
//       messageDiv.textContent = '';
//     }, 3000);
//   }
// }

// // 測試通知
// function testNotification() {
//   const messageDiv = document.getElementById('testMessage');

//   try {
//     // 測試音效
//     const audio = new Audio('files/notification.mp3');
//     audio.play().catch(err => {
//       console.log('音效播放失敗（可能尚未上傳音效檔）:', err);
//     });

//     // 測試震動
//     if ('vibrate' in navigator) {
//       navigator.vibrate([200, 100, 200]);
//       messageDiv.textContent = '✓ 音效和震動測試成功';
//       messageDiv.className = 'testMessage';
//     } else {
//       messageDiv.textContent = '✓ 音效測試成功（此裝置不支援震動）';
//       messageDiv.className = 'testMessage';
//     }
//   } catch (err) {
//     messageDiv.textContent = '✗ 測試失敗：' + err.message;
//     messageDiv.className = 'testMessage error';
//   }

//   // 3秒後清除訊息
//   setTimeout(() => {
//     messageDiv.textContent = '';
//   }, 3000);
// }

// // 播放通知
// function playNotification() {
//   try {
//     // 播放音效
//     const audio = new Audio('files/notification.mp3');
//     audio.play().catch(err => {
//       console.log('音效播放失敗:', err);
//     });

//     // 震動
//     if ('vibrate' in navigator) {
//       navigator.vibrate([200, 100, 200, 100, 200]);
//     }
//   } catch (err) {
//     console.error('通知播放失敗:', err);
//   }
// }

// // 檢查並執行通知
// function checkAndNotify() {
//   const settings = getNotificationSettings();

//   // 如果通知功能未啟用或沒有選擇任何時間，直接返回
//   if (!settings.enabled || settings.selectedTimes.length === 0) {
//     return;
//   }

//   const now = getNowBySVR();
//   const currentHour = now.getHours();
//   const currentMinute = now.getMinutes();

//   // 為每個選中的時間檢查是否需要通知
//   settings.selectedTimes.forEach(eventHour => {
//     // 計算通知時間範圍（最多提前45分鐘，不會跨日）
//     const eventTotalMinutes = eventHour * 60;
//     const startTotalMinutes = eventTotalMinutes - settings.notifyBefore;
//     const endTotalMinutes = eventTotalMinutes - 10;
//     const currentTotalMinutes = currentHour * 60 + currentMinute;

//     // 檢查當前時間是否在通知範圍內
//     if (currentTotalMinutes < startTotalMinutes || currentTotalMinutes > endTotalMinutes) {
//       return;
//     }

//     // 檢查是否是10分鐘的整數倍
//     const minutesSinceStart = currentTotalMinutes - startTotalMinutes;
//     if (minutesSinceStart % 10 !== 0) {
//       return;
//     }

//     // 檢查是否已經在這個時間點通知過
//     const today = now.toISOString().split('T')[0];
//     const notifyKey = `${today}-${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

//     if (settings.lastNotified[notifyKey]) {
//       return; // 已經通知過了
//     }

//     // 執行通知
//     playNotification();

//     // 記錄已通知
//     settings.lastNotified[notifyKey] = true;

//     // 清理超過1天的記錄
//     Object.keys(settings.lastNotified).forEach(key => {
//       const keyDate = key.split('-').slice(0, 3).join('-');
//       const keyTime = new Date(keyDate);
//       const daysDiff = (now - keyTime) / (1000 * 60 * 60 * 24);
//       if (daysDiff > 1) {
//         delete settings.lastNotified[key];
//       }
//     });

//     saveNotificationSettings(settings);
//   });
// }

// // 每分鐘檢查一次是否需要通知
// setInterval(checkAndNotify, 60000);

// // 頁面載入時立即檢查一次
// checkAndNotify();