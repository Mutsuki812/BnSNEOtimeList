/* ==========================
   ==== UI表示コンポーネント ====
   ========================== */

import { TEXTS } from './config.js';
import { DOMHelper } from './utils.js';

/**
 * UIレンダラー
 */
export class UIRenderer {
  constructor(languageManager, timeUtils, taskUtils, soundManager) {
    this.languageManager = languageManager;
    this.timeUtils = timeUtils;
    this.taskUtils = taskUtils;
    this.soundManager = soundManager;
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

  // 常設のお知らせ
  updateRegularNotice() {
    console.log('常態公告>>>');
    const text = TEXTS.regularNotice[this.languageManager.current];
    DOMHelper.updateElement("regularNotice", text, "block");
  }

  // 期間限定のお知らせ
  updateTemporaryNoticeText() {
    console.log('限時公告>>>');
    const text = TEXTS.temporaryNotice[this.languageManager.current];
    DOMHelper.updateElement("temporaryNotice", text);
  }

  // 中国語環境のみ終日ボタンを表示
  updateViewDailyButtonVisibility() {
    const viewDailyBtn = document.getElementById("viewDailyBtn");
    if (viewDailyBtn) {
      viewDailyBtn.style.display = this.languageManager.current === "zh" ? "none" : "none";
    }
  }

  // 前の1時間
  createPreviousHourTaskRow(item, currentItem, currentHour, currentMinute, type) {
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

    let hintText;
    const hints = TEXTS.previousHourHint[this.languageManager.current];

    if (this.languageManager.current === 'zh' && typeof hints === 'object' && type) {
      hintText = hints[type.key] || hints.default;
    } else {
      hintText = hints;
    }

    taskRow.innerHTML = `
      <span class="previoushour_placeholder">${hintText}</span>
      <span class="col-time gray">${timeText}</span>
      <span class="col-questionMark gray">${questionMark}</span>
      <span class="col-content gray">${content}</span>
    `;

    return taskRow;
  }

  // 現在の時間
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

    let soundToggleHtml = '';
    // 中国語環境かつsoundManagerが利用可能な場合のみ表示
    if (this.languageManager.current === 'zh' && this.soundManager) {
      const isSoundOn = this.soundManager.isSoundEnabled(type.key);
      const iconSrc = isSoundOn ? './images/bell32.png' : './images/bellSlash32.png';
      soundToggleHtml = `<button class="sound-toggle-btn" data-task-type="${type.key}" title="切換音效提示"><img src="${iconSrc}" alt="sound" style="vertical-align:middle;"></button> `;
    }

    row.innerHTML = `
      <div class="sound">${soundToggleHtml}</div>
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

  // 次の2時間 + 残りの時間
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
      <span class=""></span>
      <span class="placeholder">${tomorrow}</span>
      <span class="col-time ${maintenanceClass}">${timeText}</span>
      <span class="col-questionMark ${maintenanceClass}">${questionMark}</span>
      <span class="col-content ${maintenanceClass}">${content}</span>
    `;

    return taskRow;
  }

  // その他の時間/閉じる ボタン
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

  /**
   * コンテナ内のすべての .col-content のフォントサイズを自動調整し、テキストが1行で表示されるようにする
   * コンテンツカラムのみ対象とし、.col-typeには影響しない
   * @param {HTMLElement} container 
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
}