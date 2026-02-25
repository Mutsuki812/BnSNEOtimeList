/* ==========================
   === Excelデータ処理 ===
   ========================== */

import { CONFIG, DATE_RANGES, TASK_TYPES } from './config.js';
import { TimeUtils, TaskUtils } from './utils.js';

/**
 * Excelデータローダー
 */
export class ExcelDataLoader {
  constructor(languageManager, timeUtils) {
    this.languageManager = languageManager;
    this.timeUtils = timeUtils;
  }

  _isInDateRange() {
    if (!this.timeUtils) return false;

    // const now = this.timeUtils.getNowBySVR();
    // const range = DATE_RANGES[this.languageManager.current];
    // if (!range) return false;
    // return now >= range.start && now <= range.end;
    const now = this.timeUtils.getNowBySVR();
    const range = DATE_RANGES[this.languageManager.current];
    if (!range) return false;
    const start = this.timeUtils.getShiftedDate(range.start);
    const end = this.timeUtils.getShiftedDate(range.end);
    return now >= start && now <= end;
  }

  _loadXLSXLib() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CONFIG.XLSX_CDN;
      script.onload = resolve;
      script.onerror = () => reject(new Error("XLSX library failed to load"));
      document.head.appendChild(script);
    });
  }

  async loadExcel() {
    try {
      const isChinese = this.languageManager.current === "zh";
      // 中文語系、在特定期間內且設定了 GAS URL 時，改用 fetch 讀取 JSON
      if (isChinese && CONFIG.GAS_DATA_URL && this._isInDateRange()) {
        // 1. 嘗試讀取快取
        const cachedData = this.getFromCache();
        if (cachedData) {
          return cachedData;
        }

        const response = await fetch(`${CONFIG.GAS_DATA_URL}?t=${new Date().getTime()}`);
        const json = await response.json();
        // 假設 GAS 回傳的格式是 { status: 'success', data: [...] } 或直接是陣列
        // 這裡預設回傳結構與 sheet_to_json 結果一致
        const data = Array.isArray(json) ? json : (json.data || []);

        // 2. 寫入快取
        this.saveToCache(data);
        return data;
      }

      // 檢查是否已載入 XLSX，若無則動態載入
      if (typeof XLSX === 'undefined') {
        await this._loadXLSXLib();
      }

      // 其他情況（日文語系、或中文語系但不在期間內、或未設定 GAS URL），維持原狀讀取 Excel
      const sheetName = isChinese ? "timeList" : "timeList_JP";
      const response = await fetch(CONFIG.EXCEL_URL);
      const buffer = await response.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[0]];
      
      const rawData = XLSX.utils.sheet_to_json(sheet);

      // データの正規化：ヘッダーと値の空白を除去 (去除表頭與內容的前後空白)
      return rawData.map(row => {
        const newRow = {};
        Object.keys(row).forEach(key => {
          const cleanKey = key.trim(); // 去除欄位名稱空白
          let value = row[key];
          if (typeof value === 'string') {
            value = value.trim(); // 去除內容空白
          }
          newRow[cleanKey] = value;
        });
        return newRow;
      });
    } catch (err) {
      console.error("Excel/GAS 読み込みエラー：", err);
      return [];
    }
  }

  getFromCache() {
    try {
      const item = sessionStorage.getItem(CONFIG.CACHE_KEY);
      if (!item) return null;
      const parsed = JSON.parse(item);
      // 檢查是否過期
      if (Date.now() > parsed.expiry) {
        sessionStorage.removeItem(CONFIG.CACHE_KEY);
        return null;
      }
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  saveToCache(data) {
    try {
      const item = {
        data: data,
        expiry: Date.now() + CONFIG.CACHE_DURATION
      };
      sessionStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(item));
    } catch (e) {
      console.warn("Cache save failed", e);
    }
  }
}

/**
 * タスクデータプロセッサー
 */
export class TaskDataProcessor {
  constructor(languageManager, timeUtils, taskUtils) {
    this.languageManager = languageManager;
    this.timeUtils = timeUtils;
    this.taskUtils = taskUtils;
  }

  getVisibleTaskTypes() {
    const visibleKeys = this.languageManager.current === "zh" 
      ? ["gishiki", "shirao", "sengen"]
      : ["gishiki", "mizuki", "shirao"];
    
    return TASK_TYPES.filter(type => visibleKeys.includes(type.key));
  }

  getTaskListForWeek(rows, type, weekZh) {
    return rows
      .filter(r => r["Week-zh"] === weekZh && r[`${type.key}-time`])
      .map(r => {
        const timeResult = this.timeUtils.normalizeExcelTime(r[`${type.key}-time`]);
        
        return {
          time: timeResult.time,
          hasQuestionMark: timeResult.hasQuestionMark,
          zh: r[`${type.key}-zh`] || "",
          jp: r[`${type.key}-jp`] || "",
          isNextDay: false
        };
      })
      .sort((a, b) => this.timeUtils.timeToMinutes(a.time) - this.timeUtils.timeToMinutes(b.time));
  }

  categorizeTasksByTime(list, currentHour, currentMinute) {
    let currentItem = null;
    let previousItem = null;
    const nextItems = [];
    const remainingItemsToday = [];
    const remainingItemsTomorrow = [];

    // メンテナンス時間帯の検出
    const maintenanceHours = this._getMaintenanceHours(list);
    const isInMaintenance = maintenanceHours.has(currentHour);

    if (isInMaintenance) {
      currentItem = this._findMaintenanceItem(list, currentHour);
      this._categorizeNonMaintenanceTasks(list, currentHour, nextItems, remainingItemsToday, remainingItemsTomorrow);
    } else {
      const previousHour = (currentHour + 23) % 24;
      const halfHourStart = previousHour * 60 + 30;
      const halfHourEnd = previousHour * 60 + 59;

      list.forEach(item => {
        const [itemHour, itemMinute] = item.time.split(":").map(Number);
        const itemTotalMinutes = itemHour * 60 + (itemMinute || 0);
        const actualHour = item.isNextDay ? itemHour + 24 : itemHour;

        // 前の時間帯のタスク
        if (!item.isNextDay && !this.taskUtils.isMaintenanceTask(item)) {
          if (itemTotalMinutes >= halfHourStart && itemTotalMinutes <= halfHourEnd) {
            // 現在時間が「タスク時間 + 30分」を超えていない場合のみ表示
            const currentTotalMinutes = currentHour * 60 + currentMinute;
            const taskDeadlineMinutes = itemTotalMinutes + 30;
            
            if (currentTotalMinutes <= taskDeadlineMinutes) {
              previousItem = item;
            }
          }
        }

        // 現在のタスク
        if (actualHour === currentHour) {
          currentItem = item;
        }
        // 次の2時間のタスク
        else if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
          nextItems.push(item);
        }
        // 残りのタスク（今日）
        else if (actualHour > currentHour + 2 && !item.isNextDay && itemHour <= 23) {
          remainingItemsToday.push(item);
        }
        // 翌日早朝のタスク
        else if (item.isNextDay && itemHour >= 0 && itemHour <= 5 && actualHour > currentHour + 2) {
          remainingItemsTomorrow.push(item);
        }
      });
    }

    const remainingItems = remainingItemsToday.length > 0 || currentHour < 21
      ? remainingItemsToday
      : remainingItemsTomorrow;

    return { previousItem, currentItem, nextItems, remainingItems, isInMaintenance };
  }

  _getMaintenanceHours(list) {
    const maintenanceHours = new Set();
    
    list.forEach(item => {
      if (this.taskUtils.isMaintenanceTask(item)) {
        if (typeof item.maintenanceSpanStart === 'number' && typeof item.maintenanceSpanEnd === 'number') {
          for (let h = item.maintenanceSpanStart; h <= item.maintenanceSpanEnd; h++) {
            maintenanceHours.add(h);
          }
        } else {
          const itemHour = parseInt(item.time.split(":")[0]);
          maintenanceHours.add(itemHour);
        }
      }
    });
    
    return maintenanceHours;
  }

  _findMaintenanceItem(list, currentHour) {
    let maintenanceItem = list.find(it => {
      if (!this.taskUtils.isMaintenanceTask(it)) return false;
      if (typeof it.maintenanceSpanStart === 'number' && typeof it.maintenanceSpanEnd === 'number') {
        return currentHour >= it.maintenanceSpanStart && currentHour <= it.maintenanceSpanEnd;
      }
      const itemHour = parseInt((it.time || '').split(':')[0]);
      return itemHour === currentHour;
    });

    if (!maintenanceItem) {
      maintenanceItem = list.find(it => this.taskUtils.isMaintenanceTask(it)) || null;
    }

    return maintenanceItem;
  }

  _categorizeNonMaintenanceTasks(list, currentHour, nextItems, remainingItemsToday, remainingItemsTomorrow) {
    list.forEach(item => {
      if (this.taskUtils.isMaintenanceTask(item)) return;

      const itemHour = parseInt(item.time.split(":")[0]);
      const actualHour = item.isNextDay ? itemHour + 24 : itemHour;

      if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
        nextItems.push(item);
      } else if (actualHour > currentHour + 2 && !item.isNextDay && itemHour <= 23) {
        remainingItemsToday.push(item);
      } else if (item.isNextDay && itemHour >= 0 && itemHour <= 5 && actualHour > currentHour + 2) {
        remainingItemsTomorrow.push(item);
      }
    });
  }
}