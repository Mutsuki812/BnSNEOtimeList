/* ==========================
   ==== 工具函式 ====
   ========================== */

import { MAINTENANCE_PATTERN, WEEKDAYS } from './config.js';

/**
 * 時間相關的工具函式
 */
export class TimeUtils {
  constructor() {}
  
  /**
   * 將給定的 Date 物件強制轉換為 UTC+8 時區
   * @param {Date} date - 輸入的日期物件
   * @returns {Date} - UTC+8 時區的日期物件
   */
  getShiftedDate(date) {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const offset = 8 * 60 * 60000; // Force UTC+8
    return new Date(utc + offset);
  }

  /**
   * 獲取當前伺服器時間 (UTC+8)
   * @returns {Date} - 當前 UTC+8 時間的日期物件
   */
  getNowBySVR() {
    return this.getShiftedDate(new Date());
  }
  
  /**
   * 將 Date 物件格式化為 "年/月/日 (星期)" 的字串
   * @param {Date} date - 要格式化的日期物件
   * @returns {string} - 格式化後的日期字串
   */
  formatDateLabel(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = WEEKDAYS[date.getDay()];
    return `${year}/${month}/${day}（${weekday}）`;
  }

  /**
   * 將 "HH:MM" 格式的時間字串轉換為今天的 Date 物件
   * @param {string} timeStr - "HH:MM" 格式的時間字串
   * @returns {Date|null} - 今天的日期物件，如果格式錯誤則返回 null
   */
  timeStringToDateToday(timeStr) {
    const now = this.getNowBySVR();
    const [h, m] = (timeStr || "--:--").split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  }

  /**
   * 將 "HH:MM" 格式的時間字串轉換為從午夜開始的總分鐘數
   * @param {string} timeStr - "HH:MM" 格式的時間字串
   * @returns {number} - 總分鐘數
   */
  timeToMinutes(timeStr) {
    // 檢查時間是否為有效字串
    if (typeof timeStr !== 'string' || timeStr.trim() === '') {
        console.warn("傳入的時間字串無效:", timeStr);
        return 0; // 作為錯誤處理
    }
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + (minutes || 0);
  }

  /**
   * 標準化從 Excel 讀取的時間。處理數字格式和包含特殊標記的字串
   * @param {string|number} timeStr - 從 Excel 讀取的時間值
   * @returns {{time: string, hasQuestionMark: boolean}} - 包含標準化時間和問號標記的物件
   */
  normalizeExcelTime(timeStr) {
    if (typeof timeStr === 'number') {
      const hours = Math.floor(timeStr * 24);
      const minutes = Math.floor((timeStr * 24 - hours) * 60);
      return {
        time: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`,
        hasQuestionMark: false
      };
    }
    
    let actualTime = String(timeStr || "00:00");
    const hasQuestionMark = actualTime.includes("_?");
    actualTime = actualTime.replace("_?", "");
    
    return { time: actualTime, hasQuestionMark };
  }

  /**
   * 將 Date 物件格式化為 "YYYY-MM-DD" 格式的字串
   * @param {Date} date - 要格式化的日期物件
   * @returns {string} - "YYYY-MM-DD" 格式的字串
   */
  formatDateToYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

/**
 * 任務相關的工具函式
 */
export class TaskUtils {
  constructor() {}

  /**
   * 檢查一個任務項目是否為維護任務
   * @param {object} item - 任務項目物件
   * @returns {boolean} - 如果是維護任務則返回 true
   */
  isMaintenanceTask(item) {
    if (!item) return false;
    const content = this.getTaskContent(item);
    return MAINTENANCE_PATTERN.test(content);
  }

  /**
   * 獲取任務項目的內容 (中文字串)
   * @param {object} item - 任務項目物件
   * @returns {string} - 任務內容
   */
  getTaskContent(item) {
    return item.zh;
  }

  /**
   * 合併列表中連續的相同維護任務
   * 例如，將多個小時的 "維護中" 合併為一個帶有開始和結束時間的項目
   * @param {Array<object>} list - 任務列表
   * @returns {Array<object>} - 合併後的任務列表
   */
  mergeConsecutiveMaintenance(list) {
    const merged = [];
    let skipUntil = -1;

    list.forEach((item, index) => {
      if (index < skipUntil) return;

      const content = this.getTaskContent(item);
      const isMaintenance = MAINTENANCE_PATTERN.test(content);

      if (isMaintenance) {
        let lastIndex = index;
        for (let i = index + 1; i < list.length; i++) {
          const nextContent = this.getTaskContent(list[i]);
          if (nextContent === content) {
            lastIndex = i;
          } else {
            break;
          }
        }

        const startHour = parseInt(item.time.split(":")[0]);
        const endHour = parseInt(list[lastIndex].time.split(":")[0]);

        const mergedItem = {
          ...item,
          maintenanceSpanStart: startHour,
          maintenanceSpanEnd: endHour
        };
        merged.push(mergedItem);
        skipUntil = lastIndex + 1;
      } else {
        merged.push(item);
      }
    });

    return merged;
  }
}

/**
 * DOM 操作的輔助函式
 */
export class DOMHelper {
  /**
   * 更新指定 ID 元素的內容和顯示狀態
   * @param {string} id - 元素的 ID
   * @param {string} content - 要設置的 innerHTML 內容
   * @param {string|null} display - 要設置的 display 樣式 (例如 "block", "none")
   */
  static updateElement(id, content, display = null) {
    const element = document.getElementById(id);
    if (!element) return;
    
    if (content !== undefined) {
      element.innerHTML = content;
    }
    if (display !== null) {
      element.style.display = display;
    }
  }

  /**
   * 創建一個新的 DOM 元素
   * @param {string} tag - 元素標籤名 (例如 "div", "span")
   * @param {string} className - 要添加的 CSS class
   * @param {string} innerHTML - 元素的 innerHTML
   * @returns {HTMLElement} - 創建的元素
   */
  static createElement(tag, className, innerHTML = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (innerHTML) element.innerHTML = innerHTML;
    return element;
  }

  /**
   * 清空指定 ID 元素的內容
   * @param {string} id - 元素的 ID
   */
  static clearElement(id) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = '';
  }
}

/**
 * localStorage 的輔助函式，用於簡化存取
 */
export class StorageHelper {
  /**
   * 從 localStorage 獲取一個項目。會自動 JSON.parse
   * @param {string} key - 儲存的鍵
   * @param {*} [defaultValue=null] - 如果找不到項目時的預設值
   * @returns {*} - 儲存的值或預設值
   */
  static get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error('儲存空間讀取錯誤:', e);
      return defaultValue;
    }
  }

  /**
   * 將一個項目存儲到 localStorage。會自動 JSON.stringify
   * @param {string} key - 儲存的鍵
   * @param {*} value - 要儲存的值
   * @returns {boolean} - 是否成功儲存
   */
  static set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('儲存空間設定錯誤:', e);
      return false;
    }
  }

  /**
   * 從 localStorage 移除一個項目
   * @param {string} key - 要移除的鍵
   */
  static remove(key) {
    localStorage.removeItem(key);
  }
}