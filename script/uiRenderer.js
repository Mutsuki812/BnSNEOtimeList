/* ============================================================
   UI 渲染器
   負責將任務資料轉換為 DOM 元素，並更新畫面上的各個 UI 區塊。
   本類別只負責「產生 HTML 元素」，不直接處理資料邏輯或網路請求。
   ============================================================ */

import { TEXTS } from "./config.js";
import { DOMHelper } from "./utils.js";

/**
 * UI 渲染器類別。
 * 接收任務資料，輸出對應的 DOM 元素供 main.js 掛載至畫面。
 */
export class UIRenderer {
  /**
   * @param {import('./utils.js').TimeUtils}  timeUtils   - 時間工具實例
   * @param {import('./utils.js').TaskUtils}  taskUtils   - 任務邏輯工具實例
   * @param {import('./soundManager.js').SoundManager} soundManager - 音效管理器實例
   */
  constructor(timeUtils, taskUtils, soundManager) {
    this.timeUtils   = timeUtils;
    this.taskUtils   = taskUtils;
    this.soundManager = soundManager;
  }

  // ============================================================
  // 頂部時間顯示
  // ============================================================

  /**
   * 更新頂部時間顯示區塊（#timeBox）。
   * 顯示台灣時間（UTC+8）的日期、星期與目前時刻（HH:MM:SS）。
   */
  updateTopTime() {
    const now         = this.timeUtils.getNowBySVR();
    const timeStr     = now.toLocaleTimeString("zh-TW", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const dateFullStr = this.timeUtils.formatDateLabel(now); // "2024/4/20（六）"

    // 拆分日期與星期，為星期字元套用圓圈樣式
    const dateParts   = dateFullStr.match(/(.*)（(.)）/);
    let   dateOnlyStr = dateFullStr;
    let   weekdayHtml = "";

    if (dateParts?.length === 3) {
      dateOnlyStr = dateParts[1]; // "2024/4/20"
      weekdayHtml = `<span class="weekdayCircle">${dateParts[2]}</span>`; // "六"
    }

    DOMHelper.updateElement(
      "timeBox",
      `<div class="timeLabel admin-trigger" style="cursor: default;">台灣時間</div>
       <div class="datetimeBox">
         <div class="dateValue">${dateOnlyStr}&nbsp;&nbsp;${weekdayHtml}</div>
         <div class="timeValue">${timeStr}</div>
       </div>`
    );
  }

  // ============================================================
  // 公告文字更新
  // ============================================================

  /**
   * 更新標題公告（#titleNotice），固定顯示，不受活動期間影響。
   */
  updateTitleNotice() {
    DOMHelper.updateElement("titleNotice", TEXTS.titleNotice, "block");
  }

  /**
   * 更新常態說明文字（#regularNotice），僅在活動期間外顯示。
   */
  updateRegularNotice() {
    DOMHelper.updateElement("regularNotice", TEXTS.regularNotice, "block");
  }

  /**
   * 更新限時公告文字（#temporaryNotice），僅在活動期間內顯示。
   */
  updateTemporaryNoticeText() {
    DOMHelper.updateElement("temporaryNotice", TEXTS.temporaryNotice, "block");
  }

  // ============================================================
  // 任務列建立
  // ============================================================

  /**
   * 建立「前一小時任務」的提示列。
   * 顯示在當前任務列上方，提示玩家前一個出現的 Boss 可能尚未消失。
   *
   * 顯示條件：
   * - previousItem 存在且有地點資料
   * - 若 currentItem 存在，需確認當前時間尚未到達 currentItem 的出現時間
   *
   * @param {object|null} item          - 前一小時的任務項目
   * @param {object|null} currentItem   - 當前小時的任務項目（用於判斷是否還有必要顯示）
   * @param {number}      currentHour   - 當前小時
   * @param {number}      currentMinute - 當前分鐘
   * @param {object}      type          - 任務類型物件（含 key 等屬性）
   * @returns {HTMLElement|DocumentFragment} - 建立的元素；不需顯示時回傳空的 DocumentFragment
   */
  createPreviousHourTaskRow(item, currentItem, currentHour, currentMinute, type) {
    if (!item) return document.createDocumentFragment();

    // 若當前任務已到達出現時間，前一小時提示就沒有意義了
    if (currentItem) {
      const [cHour, cMinute] = (currentItem.time || "00:00").split(":").map(Number);
      const nowTotalMins  = currentHour * 60 + currentMinute;
      const taskTotalMins = cHour * 60 + cMinute;
      if (nowTotalMins >= taskTotalMins) return document.createDocumentFragment();
    }

    const content = this.taskUtils.getTaskContent(item);
    if (!content || content.trim() === "") return document.createDocumentFragment();

    const timeText     = item.time || "--:--";
    const questionMark = item.hasQuestionMark ? " [?]" : "";
    const isAlert      = this.timeUtils.isWithinWindow(timeText, 5);
    const hintText     = TEXTS.previousHourHint[type.key] || "";
    const longClass    = this._getLongClass(content);

    const taskRow      = DOMHelper.createElement("div", `previoushour${isAlert ? " task-alert-active" : ""}`);
    taskRow.innerHTML  = `
      <span class="previoushour_placeholder">${hintText}</span>
      <span class="col-time gray">${timeText}</span>
      <span class="col-questionMark gray">${questionMark}</span>
      <span class="col-content gray ${longClass}">${content}</span>
    `;

    return taskRow;
  }

  /**
   * 建立「當前任務」的主要顯示列（最大且最顯眼的一列）。
   * 包含任務類型標題、時間、地點，以及音效開關圖示。
   *
   * @param {object}      type         - 任務類型物件（含 key、label 等屬性）
   * @param {object|null} item         - 當前任務項目；null 表示此時段無任務
   * @param {boolean}     [isOnlineMode=false] - 是否處於線上回報模式（會影響警示與音效圖示邏輯）
   * @returns {HTMLElement} - 建立的任務列元素
   */
  createCurrentTaskRow(type, item, isOnlineMode = false) {
    const row          = DOMHelper.createElement("div", `taskRow ${type.key} current`);
    const isMaintenance = item && this.taskUtils.isMaintenanceTask(item);
    let   content      = item ? this.taskUtils.getTaskContent(item) : "-------";
    let   timeText     = "--:--";
    let   questionMark = "";

    if (!isMaintenance) {
      if (item) {
        questionMark = item.hasQuestionMark ? " [?]" : "";
        timeText     = item.time || "--:--";
      }
    }
    if (content === "") {
      timeText = "--:--";
      content  = "-------";
    }

    const longClass  = this._getLongClass(content);
    // 線上模式下，靜態班表的時間不應觸發警示樣式（由線上資料決定）
    const isAlert    = isOnlineMode ? false : this.timeUtils.isWithinWindow(timeText, 5);
      const alertClass = isAlert ? "task-alert-active" : "";
    const maintenanceClass = isMaintenance ? "maintenance" : "";

    // shirao/sengen: 超過任務時間+5分鐘 → 灰色；gishiki: 超過任務時間+35分鐘 → 灰色
    let pastClass = "";
    const pastOffsetMap = { shirao: 5, sengen: 5, gishiki: 35 };
    const pastOffset = pastOffsetMap[type.key] ?? null;
    if (pastOffset !== null && !isMaintenance && !isOnlineMode && item && timeText && timeText !== "--:--") {
      const now = this.timeUtils.getNowBySVR();
      const [taskH, taskM] = timeText.split(":").map(Number);
      if (now.getHours() * 60 + now.getMinutes() > taskH * 60 + taskM + pastOffset) {
        pastClass = "gray";
      }
    }

    // 音效圖示邏輯：
    // - 線上模式下的儀式 (gishiki) 不顯示音效圖示（由線上回報系統自行處理）
    // - 其餘情況依 SoundManager 設定顯示對應圖示
    let soundToggleHtml = "";
    if (this.soundManager && !(isOnlineMode && type.key === "gishiki")) {
      const isSoundOn = this.soundManager.isSoundEnabled(type.key);
      const iconSrc   = isSoundOn ? "./images/bell32_c.png" : "./images/bellSlash32.png";
      soundToggleHtml = `
        <img src="${iconSrc}" alt="音效切換" class="sound-toggle-icon"
             title="${isSoundOn ? "關閉音效" : "開啟音效"}">
      `;
    }

    row.className = `taskRow ${type.key} current ${alertClass}`;
    row.innerHTML = `
      <span class="col-sound">${soundToggleHtml}</span>
      <span class="col-typeLabel ${maintenanceClass}">${type.label}</span>
      <span class="col-time ${maintenanceClass} ${pastClass}">${timeText}</span>
      <span class="col-questionMark ${maintenanceClass} ${pastClass}">${questionMark}</span>
      <span class="col-content ${maintenanceClass} ${longClass} ${pastClass}">${content}</span>
    `;

    // 綁定音效圖示的點擊事件
    if (this.soundManager) {
      const icon = row.querySelector(".sound-toggle-icon");
      if (icon) {
        icon.addEventListener("click", () => {
          this.soundManager.unlockAudio();
          this.soundManager.toggleSound(type.key);
          // 切換後播放確認音效
          if (this.soundManager.isSoundEnabled(type.key)) {
            this.soundManager.playEffect("./audio/soundON.mp3");
          }
          // 更新圖示
          icon.src   = this.soundManager.isSoundEnabled(type.key) ? "./images/bell32_c.png" : "./images/bellSlash32.png";
          icon.title = this.soundManager.isSoundEnabled(type.key) ? "關閉音效" : "開啟音效";
        });
      }
    }

    return row;
  }

  /**
   * 建立一般任務列（用於「接下來 2 小時」或「其他時間」區塊）。
   *
   * @param {object}  item              - 任務項目物件
   * @param {boolean} [isRemaining=false] - true 表示此列屬於可折疊的「其他時間」區塊
   * @param {object}  [type=null]       - 任務類型物件（用於添加類型 CSS class）
   * @returns {HTMLElement|DocumentFragment} - 建立的任務列元素；內容為空時回傳空 Fragment
   */
  createTaskRow(item, isRemaining = false, type = null) {
    const content = this.taskUtils.getTaskContent(item);
    if (!content || content.trim() === "") return document.createDocumentFragment();

    const rowClass      = isRemaining ? "taskRow remaining" : "taskRow";
    const typeClass     = type ? type.key : "";
    const finalRowClass = typeClass ? `${rowClass} ${typeClass}` : rowClass;

    const taskRow       = DOMHelper.createElement("div", finalRowClass);
    const isMaintenance = this.taskUtils.isMaintenanceTask(item);
    const maintenanceClass = isMaintenance ? "maintenance" : "";
    const timeText      = isMaintenance ? "" : (item.time || "--:--");
    const questionMark  = (!isMaintenance && item.hasQuestionMark) ? " [?]" : "";
    const longClass     = this._getLongClass(content);
    const tomorrowHtml  = item.isNextDay ? `<span class="tomorrow">明天</span>` : "";

    // shirao/sengen: 超過任務時間+5分鐘 → 灰色；gishiki: 超過任務時間+35分鐘 → 灰色
    let pastClass = "";
    const pastOffsetMap = { shirao: 5, sengen: 5, gishiki: 35 };
    const pastOffset = type ? (pastOffsetMap[type.key] ?? null) : null;
    if (pastOffset !== null && !isMaintenance && !item.isNextDay && timeText && timeText !== "--:--") {
      const now = this.timeUtils.getNowBySVR();
      const [taskH, taskM] = timeText.split(":").map(Number);
      if (now.getHours() * 60 + now.getMinutes() > taskH * 60 + taskM + pastOffset) {
        pastClass = "gray";
      }
    }

    taskRow.innerHTML = `
      <span class=""></span>
      <span class="placeholder">${tomorrowHtml}</span>
      <span class="col-time ${maintenanceClass} ${pastClass}">${timeText}</span>
      <span class="col-questionMark ${maintenanceClass} ${pastClass}">${questionMark}</span>
      <span class="col-content ${maintenanceClass} ${longClass} ${pastClass}">${content}</span>
    `;

    return taskRow;
  }

  /**
   * 建立「其他時間」區塊的頁尾，包含展開/收合按鈕。
   * 若剩餘任務列表為空，則只回傳空的頁尾容器（不含按鈕）。
   *
   * @param {HTMLElement} remWrapper        - 剩餘任務的容器元素（toggleable）
   * @param {Array}       remainingItems    - 剩餘任務陣列（用於判斷是否需要顯示按鈕）
   * @param {boolean}     [isInitiallyOpen=false] - 初始狀態是否為展開
   * @returns {HTMLElement} - 頁尾元素
   */
  createFooterWithButton(remWrapper, remainingItems, isInitiallyOpen = false) {
    const footer = DOMHelper.createElement("div", "groupFooter");
    if (remainingItems.length === 0) return footer;

    const btn      = DOMHelper.createElement("button", "showBtn");
    btn.type       = "button";
    btn.textContent = isInitiallyOpen ? "其他時間 ▲" : `其他時間 ▼`;

    btn.addEventListener("click", () => {
      const isOpen = remWrapper.classList.toggle("open");
      btn.textContent = isOpen ? "其他時間 ▲" : `其他時間 ▼`;
    });

    footer.appendChild(btn);
    return footer;
  }

  // ============================================================
  // 私有輔助方法
  // ============================================================

  /**
   * 依據內容字串長度，回傳對應的文字長度 CSS class。
   * 用於對長地點名稱套用較小的字體或換行樣式。
   * @param {string} content - 任務內容字串
   * @returns {string} - CSS class 名稱（"long" | "very-long" | ""）
   */
  _getLongClass(content) {
    if (!content) return "";
    if (content.length > 10) return "very-long";
    if (content.length > 6)  return "long";
    return "";
  }
}
