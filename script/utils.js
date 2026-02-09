/* ==========================
   ==== ユーティリティ関数 ====
   ========================== */

import { MAINTENANCE_PATTERN, WEEKDAYS } from './config.js';

/**
 * 言語管理クラス
 */
export class LanguageManager {
  constructor() {
    this.lang = "zh";
  }

  detect() {
    const savedLang = localStorage.getItem('userLang');
    if (savedLang) {
      this.lang = savedLang;
    } else {
      const timezoneOffset = -new Date().getTimezoneOffset() / 60;
      this.lang = timezoneOffset === 9 ? "jp" : "zh";
    }
    this.updateHtmlLang();
  }

  toggle() {
    this.lang = this.lang === "zh" ? "jp" : "zh";
    localStorage.setItem('userLang', this.lang);
    this.updateHtmlLang();
  }

  updateHtmlLang() {
    document.documentElement.setAttribute('lang', this.lang);
  }

  get current() {
    return this.lang;
  }
}

/**
 * 時間ユーティリティ
 */
export class TimeUtils {
  constructor(languageManager) {
    this.languageManager = languageManager;
  }

  getNowBySVR() {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const offset = (this.languageManager.current === "zh" ? 8 : 9) * 60 * 60000;
    return new Date(utc + offset);
  }

  formatDateLabel(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const weekday = WEEKDAYS[this.languageManager.current][date.getDay()];
    return `${year}/${month}/${day}（${weekday}）`;
  }

  timeStringToDateToday(timeStr) {
    const now = this.getNowBySVR();
    const [h, m] = (timeStr || "--:--").split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
  }

  timeToMinutes(timeStr) {
        // 時間が文字列か空か
    if (typeof timeStr !== 'string' || timeStr.trim() === '') {
        console.warn("渡された時間文字列が無効です:", timeStr);
        return 0; // エラーとして処理
    }
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + (minutes || 0);
  }

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
}

/**
 * タスクユーティリティ
 */
export class TaskUtils {
  constructor(languageManager) {
    this.languageManager = languageManager;
  }

  isMaintenanceTask(item) {
    if (!item) return false;
    const content = this.getTaskContent(item);
    return MAINTENANCE_PATTERN.test(content);
  }

  getTaskContent(item) {
    return this.languageManager.current === "zh" ? item.zh : item.jp;
  }

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
 * DOM操作ヘルパー
 */
export class DOMHelper {
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

  static createElement(tag, className, innerHTML = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (innerHTML) element.innerHTML = innerHTML;
    return element;
  }

  static clearElement(id) {
    const element = document.getElementById(id);
    if (element) element.innerHTML = '';
  }
}

/**
 * ストレージヘルパー
 */
export class StorageHelper {
  static get(key, defaultValue = null) {
    try {
      const item = localStorage.getItem(key);
      return item ? JSON.parse(item) : defaultValue;
    } catch (e) {
      console.error('ストレージ取得エラー:', e);
      return defaultValue;
    }
  }

  static set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('ストレージ設定エラー:', e);
      return false;
    }
  }

  static remove(key) {
    localStorage.removeItem(key);
  }
}