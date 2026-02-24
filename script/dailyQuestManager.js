/* ==========================
   ==== 每日任務頁面邏輯 ====
   ========================== */

import { LanguageManager, TimeUtils, TaskUtils, DOMHelper } from './utils.js';
import { ExcelDataLoader, TaskDataProcessor } from './taskProcessor.js';
import { WEEKDAYS, CONFIG } from './config.js';

class DailyQuestApp {
  constructor() {
    this.languageManager = new LanguageManager();
    this.timeUtils = new TimeUtils(this.languageManager);
    this.taskUtils = new TaskUtils(this.languageManager);
    this.excelLoader = new ExcelDataLoader(this.languageManager, this.timeUtils);
    this.taskProcessor = new TaskDataProcessor(this.languageManager, this.timeUtils, this.taskUtils);

    this.cachedRows = null;
    this.currentType = "sengen"; // 預設
  }

  async init() {
    this.languageManager.detect();

    this.setupEventListeners();
    await this.loadData();
    this.render();
  }

  setupEventListeners() {
    const radios = document.querySelectorAll('input[name="taskType"]');
    radios.forEach(radio => {
      if (radio.checked) {
        this.currentType = radio.value;
      }
      radio.addEventListener('change', (e) => {
        this.currentType = e.target.value;
        this.render();
      });
    });

    window.addEventListener('resize', () => {
      // 當螢幕縮小且"全部"被選中時，切換到預設選項
      if (window.innerWidth < 450 && this.currentType === 'all') {
        this.currentType = 'sengen'; // 預設值
        const defaultRadio = document.querySelector('input[name="taskType"][value="sengen"]');
        if (defaultRadio) {
          defaultRadio.checked = true;
        }
      }
      this.render();
    });
  }

  async loadData() {
    const listEl = document.getElementById("dailyList");
    listEl.innerHTML = '<div style="text-align:center;">載入中...</div>';

    this.cachedRows = await this.excelLoader.loadExcel();

    if (!this.cachedRows || this.cachedRows.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;">無法載入資料</div>';
    }
  }

  render() {
    this.updateLayout(); // 管理 #app 寬度與佈局

    if (!this.cachedRows) return;

    const listEl = document.getElementById("dailyList");
    listEl.innerHTML = "";

    // 1. 取得今天的星期 (中文)
    const now = this.timeUtils.getNowBySVR();
    const currentDay = now.getDay();
    const todayWeekZh = WEEKDAYS.zh[currentDay];

    // 2. 取得該類型的任務列表
    let tasks = [];
    if (this.currentType === 'all') {
      const types = this.taskProcessor.getVisibleTaskTypes();
      types.forEach(type => {
        const subTasks = this.taskProcessor.getTaskListForWeek(this.cachedRows, type, todayWeekZh);
        subTasks.forEach(t => t._type = type.key); // 標記任務類型以便表格分類
        tasks = tasks.concat(subTasks);
      });
      tasks.sort((a, b) => this.timeUtils.timeToMinutes(a.time) - this.timeUtils.timeToMinutes(b.time));
    } else {
      const typeObj = { key: this.currentType };
      tasks = this.taskProcessor.getTaskListForWeek(this.cachedRows, typeObj, todayWeekZh);
    }

    if (tasks.length === 0) {
      listEl.innerHTML = '<div style="text-align:center; padding: 20px;">本日無此類任務</div>';
      return;
    }

    // 3. 渲染列表
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    // 全部選項 & 螢幕寬度 >= 450
    if (this.currentType === 'all' && window.innerWidth >= 450) {
      this.renderAllTable(tasks, listEl, currentHour);
      return;
    }

    tasks.forEach(task => {
      const content = this.taskUtils.getTaskContent(task);
      
      // 處理地點空白時的顯示邏輯 (同步列表模式)
      let displayTime = task.time;
      let displayContent = content || "";
      let timeClass = "time";

      if (!content || String(content).trim() === "") {
        console.log('0000');
        const [h] = task.time.split(":");
        displayTime = `${h.padStart(2, '0')}:00`;
        timeClass += " empty-time-slot"; // 套用特殊樣式
      }

      const div = DOMHelper.createElement("div", "dailyItem");
      
      // 判斷是否為當前時段 (簡單判斷：任務時間 <= 現在 < 任務時間+1小時)
      // 或者依照需求：目前台灣時間的任務顏色不同 -> 標示出最接近現在且尚未結束的，或是當前小時的
      const [h, m] = task.time.split(":").map(Number);
      const taskTotalMinutes = h * 60 + (m || 0);
      
      // 邏輯：高亮顯示「當前小時」的任務
      // 如果需要更精細(例如儀式30分內)，可調整此處
      let isActive = false;
      if (h === currentHour) {
        isActive = true;
      }

      if (isActive) {
        div.classList.add("active");
      }

      div.innerHTML = `
        <div class="${timeClass}">${displayTime}</div>
        <div class="content">${displayContent}</div>
      `;
      listEl.appendChild(div);
    });
  }

  updateLayout() {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    // 只有當選擇"全部"且螢幕寬度足夠時，才使用寬版視圖
    if (this.currentType === 'all' && window.innerWidth >= 450) {
      appEl.classList.add('daily-wide-view');
    } else {
      appEl.classList.remove('daily-wide-view');
    }
  }

  renderAllTable(tasks, container, currentHour) {
    // 初始化 24 小時的資料桶
    const hours = Array.from({ length: 24 }, () => ({
      gishiki: [],
      shirao: [],
      sengen: []
    }));

    // 將任務分配到對應的小時與類型
    tasks.forEach(task => {
      const [hStr] = task.time.split(":");
      const h = parseInt(hStr, 10);
      if (!isNaN(h) && h >= 0 && h < 24 && task._type && hours[h][task._type]) {
        hours[h][task._type].push(task);
      } else {
        console.warn("[Table Bucket] Task dropped:", task);
      }
    });

    // 建立表格 HTML
    let html = `
      <div class="table-scroll-wrapper">
        <table class="dailyTable">
          <thead>
            <tr>
              <th colspan="2" class="th-gishiki">儀式</th>
              <th colspan="2" class="th-shirao">白青</th>
              <th colspan="2" class="th-sengen">仙幻島</th>
            </tr>
            <tr>
              <th>時間</th><th>地點</th>
              <th>時間</th><th>地點</th>
              <th>時間</th><th>地點</th>
            </tr>
          </thead>
          <tbody>
    `;

    hours.forEach((slot, hIndex) => {
      const isCurrentHour = hIndex === currentHour;
      const rowClass = isCurrentHour ? 'current-hour-row' : '';
      
      // 生成儲存格內容
      const generateCells = (taskList, hIndex) => {
        // 如果該時段沒有任務，視為"地點空白"，顯示整點時間
        if (!taskList || taskList.length === 0) {
          const hourStr = String(hIndex).padStart(2, '0');
          return `<td><div class="empty-time-slot">${hourStr}:00</div></td><td><div></div></td>`;
        }

        const timeParts = [];
        const contentParts = [];

        taskList.forEach(t => {
          const content = this.taskUtils.getTaskContent(t);
          if (content && String(content).trim() !== "") {
            console.log('YYY');
            timeParts.push(`<div>${t.time + (t.hasQuestionMark ? '?' : '')}</div>`);
            contentParts.push(`<div>${String(content)}</div>`);
          } else {
            console.log('nnn');
            const hourStr = String(hIndex).padStart(2, '0');
            timeParts.push(`<div class="empty-time-slot">${hourStr}:00</div>`);
            contentParts.push(`<div></div>`);
          }
        });
        return `<td>${timeParts.join('')}</td><td>${contentParts.join('')}</td>`;
      };

      html += `<tr class="${rowClass}">`;
      html += generateCells(slot.gishiki, hIndex);
      html += generateCells(slot.shirao, hIndex);
      html += generateCells(slot.sengen, hIndex);
      html += `</tr>`;
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new DailyQuestApp().init();
});
