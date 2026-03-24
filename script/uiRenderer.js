/* ==========================
   ==== UI表示コンポーネント ====
   ========================== */

import { TEXTS } from './config.js';
import { DOMHelper } from './utils.js';

/**
 * UI 渲染器類別，負責產生 HTML 元素
 */
export class UIRenderer {
  constructor(timeUtils, taskUtils, soundManager) {
    this.timeUtils = timeUtils;
    this.taskUtils = taskUtils;
    this.soundManager = soundManager;
  }

  /**
   * 更新頂部的目前時間顯示
   */
  updateTopTime() {
    const now = this.timeUtils.getNowBySVR();
    DOMHelper.updateElement("dateLabel", this.timeUtils.formatDateLabel(now));

    const locale = "zh-TW";
    const options = { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" };
    const timeStr = now.toLocaleTimeString(locale, options);
    const timeLabel = "台灣時間";

    DOMHelper.updateElement("timeBox", `
      <span class="timeLabel">${timeLabel}</span>
      <span class="timeValue">${timeStr}</span>
    `);
  }

  /**
   * 更新常態公告
   */
  updateRegularNotice() {
    DOMHelper.updateElement("regularNotice", TEXTS.regularNotice, "block");
  }

  /**
   * 更新限時公告
   */
  updateTemporaryNoticeText() {
    DOMHelper.updateElement("temporaryNotice", TEXTS.temporaryNotice);
  }

  /**
   * 建立前一小時的任務列 (如果有的話)
   * @param {object} item - 任務項目
   * @param {object} currentItem - 當前任務項目
   * @param {number} currentHour - 當前小時
   * @param {number} currentMinute - 當前分鐘
   * @param {object} type - 任務類型定義
   * @returns {HTMLElement|DocumentFragment} - 任務列元素
   */
  createPreviousHourTaskRow(item, currentItem, currentHour, currentMinute, type) {
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

    let hintText;
    hintText = TEXTS.previousHourHint[type.key];

    const longClass = this._getLongClass(content);

    taskRow.innerHTML = `
      <span class="previoushour_placeholder">${hintText}</span>
      <span class="col-time gray">${timeText}</span>
      <span class="col-questionMark gray">${questionMark}</span>
      <span class="col-content gray ${longClass}">${content}</span>
    `;

    return taskRow;
  }

  /**
   * 建立當前時間的任務列
   * @param {object} type - 任務類型定義
   * @param {object} item - 任務項目
   * @returns {HTMLElement} - 任務列元素
   */
  createCurrentTaskRow(type, item) {
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

    const longClass = this._getLongClass(content);

    const maintenanceClass = isMaintenance ? "maintenance" : "";
    const typeLabel = type.label;

    let soundToggleHtml = '';
    // soundManagerが利用可能な場合のみ表示
    if (this.soundManager) {
      const isSoundOn = this.soundManager.isSoundEnabled(type.key);
      const iconSrc = isSoundOn ? './images/bell32.png' : './images/bellSlash32.png';
      soundToggleHtml = `<button class="sound-toggle-btn" data-task-type="${type.key}" title="切換音效提示"><img src="${iconSrc}" alt="sound" style="vertical-align:middle;"></button> `;
    }

    row.innerHTML = `
      <div class="sound">${soundToggleHtml}</div>
      <div class="col-type">${typeLabel}</div>
      <div class="col-time ${maintenanceClass}">${timeText}</div>
      <div class="col-questionMark">${questionMark}</div>
      <div class="col-content ${maintenanceClass} ${longClass}">${content}</div>
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

    // 効果音ボタンにイベントリスナーを追加
    const soundBtn = row.querySelector('.sound-toggle-btn');
    if (soundBtn) {
      soundBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // 第一次點擊時，嘗試解鎖瀏覽器的音訊播放限制
        this.soundManager.unlockAudio();

        const taskType = soundBtn.dataset.taskType;
        // 切換設定
        this.soundManager.toggleSound(taskType);
        
        // 更新按鈕圖示
        const isSoundOn = this.soundManager.isSoundEnabled(taskType);
        const img = soundBtn.querySelector('img');
        if (img) {
          img.src = isSoundOn ? './images/bell32.png' : './images/bellSlash32.png';
        }
      });
    }

    return row;
  }

  /**
   * 建立一般任務列 (用於未來2小時或剩餘時間)
   * @param {object} item - 任務項目
   * @param {boolean} isRemaining - 是否為剩餘時間區塊 (會影響 CSS class)
   * @param {object} type - 任務類型定義 (可選)
   * @returns {HTMLElement|DocumentFragment} - 任務列元素
   */
  createTaskRow(item, isRemaining = false, type = null) {
    const content = this.taskUtils.getTaskContent(item);

    if (!content || content.trim() === "") {
      return document.createDocumentFragment();
    }

    const rowClass = isRemaining ? "taskRow remaining" : "taskRow";
    const typeClass = type ? type.key : "";
    const finalRowClass = typeClass ? `${rowClass} ${typeClass}` : rowClass;

    const taskRow = DOMHelper.createElement("div", finalRowClass);
    const isMaintenance = this.taskUtils.isMaintenanceTask(item);
    const maintenanceClass = isMaintenance ? 'maintenance' : '';

    let timeText = "";
    let questionMark = "";

    if (!isMaintenance && item) {
      questionMark = item.hasQuestionMark ? ' [?]' : '';
      timeText = item.time || "--:--";
    }

    const longClass = this._getLongClass(content);

    const nextDayLabel = "明天";
    const tomorrow = item.isNextDay ? `<span class="tomorrow">${nextDayLabel}</span>` : '';

    taskRow.innerHTML = `
      <span class=""></span>
      <span class="placeholder">${tomorrow}</span>
      <span class="col-time ${maintenanceClass}">${timeText}</span>
      <span class="col-questionMark ${maintenanceClass}">${questionMark}</span>
      <span class="col-content ${maintenanceClass} ${longClass}">${content}</span>
    `;

    return taskRow;
  }

  /**
   * 建立「其他時間」區域的頁尾與展開/收合按鈕
   * @param {HTMLElement} remWrapper - 剩餘時間的容器元素
   * @param {Array} remainingItems - 剩餘任務列表
   * @param {boolean} isInitiallyOpen - 初始狀態是否展開
   * @returns {HTMLElement} - 頁尾元素
   */
  createFooterWithButton(remWrapper, remainingItems, isInitiallyOpen = false) {
    const footer = DOMHelper.createElement("div", "groupFooter");

    if (remainingItems.length === 0) {
      return footer;
    }

    const btn = DOMHelper.createElement("button", "showBtn");
    btn.type = "button";
    btn.textContent = isInitiallyOpen
      ? "關閉 ▲" 
      : "其他時間 ▼";

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
          b.textContent = "其他時間 ▼";
        }
      });

      // 現在のエリアをトグル
      if (!isOpen) {
        remWrapper.classList.add("open");
        btn.textContent = "關閉 ▲";
      } else {
        remWrapper.classList.remove("open");
        btn.textContent = "其他時間 ▼";
      }
    });

    footer.appendChild(btn);
    return footer;
  }

  /**
   * 自動調整容器內所有 .col-content 的字體大小，確保文字顯示為單行
   * 僅針對內容欄位，不影響類型欄位
   * @param {HTMLElement} container - 容器元素
   */
  autoFitContent(container) {
    if (!container) return;

    // すべてのコンテンツカラムを選択 (.col-content)、タイプカラム (.col-type) は除外
    const elements = container.querySelectorAll('.col-content');

    elements.forEach(el => {
      // 1. フォントサイズをリセットし、CSSのデフォルト値から計算を開始するようにする
      el.style.fontSize = '';

      // 2. オーバーフローをチェック (scrollWidth > clientWidth)
      // clientWidth > 0 で要素が表示されていることを確認
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth) {
        let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
        const minSize = 10; // 最小フォントサイズ制限 (px)

        // 3. テキストがオーバーフローしなくなるか、最小制限に達するまで徐々に縮小
        while (el.scrollWidth > el.clientWidth && currentSize > minSize) {
          currentSize -= 0.5; // 每次縮小 0.5px
          el.style.fontSize = `${currentSize}px`;
        }
      }
    });
  }

  /**
   * 根據文字長度回傳對應的 CSS class
   * @param {string} text 
   * @returns {string} long11 ~ long15
   */
  _getLongClass(text) {
    if (!text) return "";
    const len = text.length;
    if (len >= 15) return "long15";
    if (len >= 14) return "long14";
    if (len >= 13) return "long13";
    if (len >= 12) return "long12";
    if (len >= 11) return "long11";
    return "";
  }
}