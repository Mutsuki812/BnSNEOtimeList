/* ==========================
   ==== UI表示コンポーネント ====
   ========================== */

import { TEXTS } from './config.js';
import { DOMHelper } from './utils.js';

/**
 * UIレンダラー
 */
export class UIRenderer {
  constructor(languageManager, timeUtils, taskUtils) {
    this.languageManager = languageManager;
    this.timeUtils = timeUtils;
    this.taskUtils = taskUtils;
  }

  updateTopTime() {
    const now = this.timeUtils.getNowBySVR();
    DOMHelper.updateElement("dateLabel", this.timeUtils.formatDateLabel(now));

    const locale = this.languageManager.current === "zh" ? "zh-TW" : "ja-JP";
    const options = { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
    const timeStr = now.toLocaleTimeString(locale, options);
    const timeLabel = this.languageManager.current === "zh" ? "台灣時間" : "日本時間";

    DOMHelper.updateElement("timeBox", `
      <span class="timeLabel">${timeLabel}</span>
      <span class="timeValue">${timeStr}</span>
    `);
  }

  // 説明公告
  updateNotice() {
    console.log('説明公告>>>');
    const text = TEXTS.notice[this.languageManager.current];
    DOMHelper.updateElement("notice", text, "block");
  }

  // シリーズの第一週目
  updateFirstWeekText() {
    console.log('シリーズの第一週目>>>');
    const text = TEXTS.firstWeek[this.languageManager.current];
    DOMHelper.updateElement("firstWeek", text);
  }

  // 前一小時
  createPreviousHourTaskRow(item, currentItem, currentHour, currentMinute) {
    console.log('前一小時>>>');
    if (!item) {
      return document.createDocumentFragment();
    }

    if (currentItem) {
      const [currentItemHour, currentItemMinute] = (currentItem.time || "00:00").split(":").map(Number);
      const nowTotalMinutes = currentHour * 60 + currentMinute;
      const taskTotalMinutes = currentItemHour * 60 + currentItemMinute;

      if (nowTotalMinutes >= taskTotalMinutes) {
        return document.createDocumentFragment();
      }
    }

    const content = this.taskUtils.getTaskContent(item);
    if (!content || content.trim() === "") {
      return document.createDocumentFragment();
    }

    const taskRow = DOMHelper.createElement("div", "previoushour");
    const timeText = item.time || "--:--";
    const questionMark = item.hasQuestionMark ? ' [?]' : "";
    const hintText = TEXTS.previousHourHint[this.languageManager.current];

    taskRow.innerHTML = `
      <span class="previoushour_placeholder">${hintText}</span>
      <span class="col-time gray">${timeText}</span>
      <span class="col-questionMark gray">${questionMark}</span>
      <span class="col-content gray">${content}</span>
    `;

    return taskRow;
  }

  // 當前時間
  createCurrentTaskRow(type, item) {
    console.log('當前時間>>>');
    const row = DOMHelper.createElement("div", `taskRow ${type.key} current`);
    const content = item ? this.taskUtils.getTaskContent(item) : "-------";
    const isMaintenance = item && this.taskUtils.isMaintenanceTask(item);

    let timeText = "";
    let questionMark = "";

    if (!isMaintenance) {
      if (item) {
        questionMark = item.hasQuestionMark ? ' [?]' : '';
        timeText = item.time || "--:--";
      } else {
        timeText = "--:--";
      }
    }

    if (content === "") {
      timeText = "--:--";
      content = "-------";
    }

    const maintenanceClass = isMaintenance ? "maintenance" : "";
    const typeLabel = this.languageManager.current === "zh" ? type.labelZh : type.labelJp;

    row.innerHTML = `
      <div class="col-type">${typeLabel}</div>
      <div class="col-time ${maintenanceClass}">${timeText}</div>
      <div class="col-questionMark">${questionMark}</div>
      <div class="col-content ${maintenanceClass}">${content}</div>
    `;

    // タスクの期限切れ判定
    if (item && !isMaintenance) {
      const taskDate = this.timeUtils.timeStringToDateToday(item.time);
      const now = this.timeUtils.getNowBySVR();
      const offsetMin = (type.key === 'gishiki') ? 3 : 5;

      if (taskDate && now.getTime() > taskDate.getTime() + offsetMin * 60000) {
        row.querySelectorAll(".col-time, .col-content").forEach(el => el.classList.add("gray"));
      }
    } else if (!item) {
      row.querySelectorAll(".col-time, .col-content").forEach(el => el.classList.add("gray"));
    }

    return row;
  }

  // 接下來兩小時 + 剩餘時間
  createTaskRow(item, isRemaining = false) {
    console.log('接下來兩小時 + 剩餘時間>>>');
    const content = this.taskUtils.getTaskContent(item);

    if (!content || content.trim() === "") {
      return document.createDocumentFragment();
    }

    const taskRow = DOMHelper.createElement("div", isRemaining ? "taskRow remaining" : "taskRow");
    const isMaintenance = this.taskUtils.isMaintenanceTask(item);
    const maintenanceClass = isMaintenance ? 'maintenance' : '';

    let timeText = "";
    let questionMark = "";

    if (!isMaintenance && item) {
      questionMark = item.hasQuestionMark ? ' [?]' : '';
      timeText = item.time || "--:--";
    }

    const nextDayLabel = this.languageManager.current === "zh" ? "明日" : "翌日";
    const tomorrow = item.isNextDay ? `<span class="tomorrow">${nextDayLabel}</span>` : '';

    taskRow.innerHTML = `
      <span class="placeholder">${tomorrow}</span>
      <span class="col-time ${maintenanceClass}">${timeText}</span>
      <span class="col-questionMark ${maintenanceClass}">${questionMark}</span>
      <span class="col-content ${maintenanceClass}">${content}</span>
    `;

    return taskRow;
  }

  // 其他時間/關閉 按鈕
  createFooterWithButton(remWrapper, remainingItems, isInitiallyOpen = false) {
    const footer = DOMHelper.createElement("div", "groupFooter");

    if (remainingItems.length === 0) {
      return footer;
    }

    const btn = DOMHelper.createElement("button", "showBtn");
    btn.type = "button";
    btn.textContent = isInitiallyOpen
      ? (this.languageManager.current === "zh" ? "關閉 ▲" : "閉じる ▲")
      : (this.languageManager.current === "zh" ? "其他時間 ▼" : "その他 ▼");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = remWrapper.classList.contains("open");

      // 他のエリアを閉じる
      document.querySelectorAll(".remainingContainer.open").forEach(el => {
        if (el !== remWrapper) el.classList.remove("open");
      });

      // 他のボタンをリセット
      document.querySelectorAll(".groupFooter .showBtn").forEach(b => {
        if (b !== btn) {
          b.textContent = this.languageManager.current === "zh" ? "其他時間 ▼" : "その他 ▼";
        }
      });

      // 現在のエリアをトグル
      if (!isOpen) {
        remWrapper.classList.add("open");
        btn.textContent = this.languageManager.current === "zh" ? "關閉 ▲" : "閉じる ▲";
      } else {
        remWrapper.classList.remove("open");
        btn.textContent = this.languageManager.current === "zh" ? "其他時間 ▼" : "その他 ▼";
      }
    });

    footer.appendChild(btn);
    return footer;
  }
}