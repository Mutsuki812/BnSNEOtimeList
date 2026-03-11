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
      const lang = this.languageManager.current;

      // 1. 嘗試從快取讀取
      const cachedData = this.getFromCache(lang);
      if (cachedData) {
        return cachedData;
      }

      let data = null;

      // 2. 根據語言和條件從遠端獲取數據
      if (lang === 'jp') { // 日文語系：只讀取靜態 JSON
        try {
          const response = await fetch(CONFIG.EXCEL_JP_JSON_URL);
          if (!response.ok) {
            throw new Error(`Failed to fetch JP JSON: ${response.statusText}`);
          }
          data = await response.json();
        } catch (e) {
          console.error("Failed to load JP JSON data. No fallback available.", e);
          data = []; // 失敗時返回空陣列，不使用 Excel 作為備用
        }
      } else { // lang === 'zh' (中文語系邏輯不變)
        if (CONFIG.GAS_DATA_URL && this._isInDateRange()) {
          // 中文語系（活動期間）：從 GAS 讀取 JSON
          try {
            const response = await fetch(`${CONFIG.GAS_DATA_URL}?t=${new Date().getTime()}`);
            const json = await response.json();
            data = Array.isArray(json) ? json : (json.data || []);
          } catch (e) {
            console.warn("GAS data load failed, falling back to Excel", e);
          }
        }

        // 如果尚未獲取數據（ZH 非活動期、或 GAS 失敗），則讀取 Excel
        if (!data) {
          if (typeof XLSX === 'undefined') {
            await this._loadXLSXLib();
          }
          const sheetName = "timeList";
          const response = await fetch(CONFIG.EXCEL_URL);
          const buffer = await response.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) {
            console.error(`Excel file does not contain a sheet named '${sheetName}'. Returning empty data.`);
            return [];
          }
          const rawData = XLSX.utils.sheet_to_json(sheet);
          
          // 正規化
          data = rawData.map(row => {
            const newRow = {};
            Object.keys(row).forEach(key => {
              const cleanKey = key.trim();
              let value = row[key];
              if (typeof value === 'string') {
                value = value.trim();
              }
              newRow[cleanKey] = value;
            });
            return newRow;
          });
        }
      }

      // 4. 寫入快取
      if (data) {
        this.saveToCache(data, lang);
      }
      return data || [];

    } catch (err) {
      console.error("Data loading error:", err);
      return [];
    }
  }

  getFromCache(lang) {
    const key = `dailyQuestData_${lang}`;
    try {
      const item = sessionStorage.getItem(key);
      if (!item) return null;
      const parsed = JSON.parse(item);
      // 檢查是否過期
      if (Date.now() > parsed.expiry) {
        sessionStorage.removeItem(key);
        return null;
      }
      return parsed.data;
    } catch (e) {
      return null;
    }
  }

  saveToCache(data, lang) {
    const key = `dailyQuestData_${lang}`;
    try {
      const item = {
        data: data,
        expiry: Date.now() + CONFIG.CACHE_DURATION
      };
      sessionStorage.setItem(key, JSON.stringify(item));
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
    // 曜日判定の強化（日文データ対応）
    const zhDays = ["日", "一", "二", "三", "四", "五", "六"];
    const jpDays = ["日", "月", "火", "水", "木", "金", "土"];
    const dayIndex = zhDays.indexOf(weekZh);
    const weekJp = dayIndex !== -1 ? jpDays[dayIndex] : null;

    return rows
      .filter(r => {
        // 1. Week-zh での一致確認（標準）
        if (r["Week-zh"] === weekZh) return true;
        // 2. Week-jp での一致確認（日文データ用）
        if (weekJp && r["Week-jp"] === weekJp) return true;
        // 3. Week-zh に日文曜日が入っている場合の確認
        if (weekJp && r["Week-zh"] === weekJp) return true;
        // 4. 汎用的な "Week" カラムの確認
        if (r["Week"] && (r["Week"] === weekZh || (weekJp && r["Week"] === weekJp))) return true;
        return false;
      })
      .filter(r => r[`${type.key}-time`])
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