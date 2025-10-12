/* ==========================
   ====== 設定 & 資料 ======
   ========================== */
const EXCEL_URL = "./files/timeList.xlsx";
const SHEET_NAME = "timeList";

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

const REPORT_STORAGE_KEY = "myReports";

// 維修任務的匹配模式
const MAINTENANCE_PATTERN = /例行維護中|定期メンテナンス中/;

/* ==========================
   ====== 語系判定 & 切換 ======
   ========================== */
let lang = "zh";

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

  updateLangButtonText();
  updateTopTime();
  loadTasksAndRender();
  updateLangText();
  updateReportText();
  updateReportTaskOptions();
  updateReportTypeOptions();
  updateReportCommentPlaceholder();
});

detectLangByTimezone();

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

// 每秒更新時間顯示
setInterval(updateTopTime, 1000);
updateTopTime();

// 將時間字串（HH:MM）轉換為今天的 Date 物件
function timeStringToDateToday(timeStr) {
  const now = getNowBySVR();
  const [h, m] = (timeStr || "--:--").split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
}

// 判斷是否應該顯示「其他時間」按鈕（21:00 後隱藏）
function shouldShowRemaining() {
  return getNowBySVR().getHours() < 21;
}

/* ==========================
   ====== 說明文字 ======
   ========================== */
function updateLangText() {
  let langText = document.querySelector(".langText");
  if (!langText) {
    langText = document.createElement("div");
    langText.className = "langText";
    document.body.appendChild(langText);
  }

  const texts = {
    zh: "<b>白青山脈S1　2025.09.03-2025.10.15</b><br>" +
      "・時間為<b>系統出字</b>提示的時間<br>" +
      "・儀式：出字提示後、等待10分鐘出怪<br>" +
      "・野王：出字提示後、等待  5分鐘出王",
    jp: "<b>白青シーズン１　2025.09.03-2025.10.15</b><br>" +
      "・表の時間＝予兆が出る時間<br>" +
      "・怪しい儀式 ：予兆後、約10分でボス出現<br>" +
      "・水月/白青FB：予兆後、約 5分でボス出現"
  };

  langText.innerHTML = texts[lang];
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
      // 找出連續相同的維修項目
      let lastIndex = index;
      for (let i = index + 1; i < list.length; i++) {
        const nextContent = getTaskContent(list[i]);
        if (nextContent === content) {
          lastIndex = i;
        } else {
          break;
        }
      }
      // 只保留第一筆
      merged.push(item);
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
  renderAllGroups(rows);
}

// 所有任務群組（儀式、水月、白青）
function renderAllGroups(rows) {
  const container = document.getElementById("taskContainer");
  container.innerHTML = "";

  const now = getNowBySVR();
  const currentHour = now.getHours();
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
    if (tomorrowList.length > 0) {
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

    // 步驟 5: 分類任務（當前、接下來、剩餘）
    const { currentItem, nextItems, remainingItems } = categorizeTasksByTime(
      combinedList,
      currentHour
    );

    // 步驟 6: 創建任務群組容器
    const group = document.createElement("div");
    group.className = `group ${type.key}`;

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
    remainingItems.forEach(item => {
      remWrapper.appendChild(createTaskRow(item, true)); // true = 在剩餘任務區
    });
    wrapper.appendChild(remWrapper);

    // 其他時間按鈕
    const footer = createFooterWithButton(remWrapper, remainingItems);
    wrapper.appendChild(footer);
    group.appendChild(wrapper);

    container.appendChild(group);
  });
}

// === 新增：取得指定星期的任務列表 ===
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

      return {
        time: String(timeStr || "00:00"),
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
  const nextItems = [];
  const remainingItemsToday = [];
  const remainingItemsTomorrow = [];   // 隔天 00:00-05:59 的任務

  list.forEach(item => {
    const itemHour = parseInt(item.time.split(":")[0]);

    // 計算實際小時數（考慮隔天的情況）
    let actualHour = itemHour;
    if (item.isNextDay) {
      actualHour = itemHour + 24; // 隔天的時間加 24
    }

    const currentActualHour = currentHour;

    // 當前任務
    if (actualHour === currentActualHour) {
      currentItem = item;
    }
    // 接下來兩小時
    else if (actualHour === currentActualHour + 1 || actualHour === currentActualHour + 2) {
      nextItems.push(item);
    }
    // 剩餘任務（今天 23:59 前）
    else if (actualHour > currentActualHour + 2 && !item.isNextDay && itemHour <= 23) {
      remainingItemsToday.push(item);
    }
    // 隔天凌晨 00:00-05:59 的任務
    else if (item.isNextDay && itemHour >= 0 && itemHour <= 5 && actualHour > currentActualHour + 2) {
      remainingItemsTomorrow.push(item);
    }
  });
  // 優先使用今天的剩餘任務，如果沒有則使用隔天凌晨的任務
  const remainingItems = remainingItemsToday.length > 0
    ? remainingItemsToday
    : remainingItemsTomorrow;

  return { currentItem, nextItems, remainingItems };
}

// 創建當前任務列
function createCurrentTaskRow(type, item) {
  const row = document.createElement("div");
  row.className = `taskRow ${type.key} current`;

  const content = item ? getTaskContent(item) : "-------";
  const isMaintenance = item && isMaintenanceTask(item);
  const timeText = isMaintenance ? "" : (item?.time || "--:--");
  const maintenanceClass = isMaintenance ? "maintenance" : "";

  row.innerHTML = `
    <div class="col-type">${lang === "zh" ? type.labelZh : type.labelJp}</div>
    <div class="col-time ${maintenanceClass}">${timeText}</div>
    <div class="col-content ${maintenanceClass}">${content}</div>
  `;

  // 判斷任務是否已過期變灰
  if (item && !isMaintenance) {
    const taskDate = timeStringToDateToday(item.time);
    const now = getNowBySVR();
    if (taskDate && now.getTime() > taskDate.getTime() + type.offsetMin * 60000) {
      row.querySelectorAll(".col-time, .col-content").forEach(el =>
        el.classList.add("gray")
      );
    }
  } else if (!item) {
    row.querySelectorAll(".col-time, .col-content").forEach(el =>
      el.classList.add("row-gray")
    );
  }

  return row;
}

// 創建一般任務列（接下來兩小時 & 剩餘任務）
function createTaskRow(item, isInRemainingArea = false) {
  const row = document.createElement("div");
  row.className = "taskRow";

  const isMaintenance = isMaintenanceTask(item);
  let timeText = isMaintenance ? "" : (item.displayTime || item.time);

  // 如果是隔天的任務且在剩餘任務區，添加視覺標記
  if (item.isNextDay && !isMaintenance) {
    const prefix = lang === "zh" ? "(明日) " : "(翌日) ";
    timeText = `<span class="tomorrow">${prefix}</span><br>
                ${timeText}`;
  }

  const maintenanceClass = isMaintenance ? "maintenance" : "";
  const content = getTaskContent(item);

  row.innerHTML = `
    <div class="placeholder"></div>
    <div class="col-time ${maintenanceClass}">${timeText}</div>
    <div class="col-content ${maintenanceClass}">${content}</div>
  `;

  // row.querySelectorAll(".col-time, .col-content").forEach(el =>
  //   el.classList.add("row-gray")
  // );

  return row;
}

// 底部按鈕區
function createFooterWithButton(remWrapper, remainingItems) {
  const footer = document.createElement("div");
  footer.className = "groupFooter";

  // 只有當有剩餘任務時才顯示按鈕
  if (remainingItems.length === 0) {
    return footer; // 沒有剩餘任務，返回空的 footer（不含按鈕）
  }

  const btn = document.createElement("button");
  btn.className = "showBtn";
  btn.textContent = lang === "zh" ? "其他時間 ▼" : "その他 ▼";
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

// 初始化
updateLangText();
updateReportText();
loadTasksAndRender();
scheduleHourlyReload();

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
  reportCommentEl.placeholder = lang === "zh" ? "10/08 19:26 地點 地點" : "10/08 19:26 場所 場所";
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

// 初始載入回報記錄
loadReports();