/* ==========================
   === Excel 資料處理 ===
   ========================== */

import { CONFIG, DATE_RANGES, TASK_TYPES } from './config.js';
import { TimeUtils, TaskUtils } from './utils.js';

/**
 * Excel 資料讀取器
 */
export class ExcelDataLoader {
  constructor(timeUtils) {
    this.timeUtils = timeUtils;
  }

  /**
   * 內部方法：檢查是否在活動日期範圍內
   * @returns {boolean}
   */
  _isInDateRange() {
    if (!this.timeUtils) return false;

    const now = this.timeUtils.getNowBySVR();
    const start = this.timeUtils.getShiftedDate(DATE_RANGES.start);
    const end = this.timeUtils.getShiftedDate(DATE_RANGES.end);
    return now >= start && now <= end;
  }

  /**
   * 內部方法：動態載入 XLSX 函式庫
   * @returns {Promise}
   */
  _loadXLSXLib() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = CONFIG.XLSX_CDN;
      script.onload = resolve;
      script.onerror = () => reject(new Error("XLSX library failed to load"));
      document.head.appendChild(script);
    });
  }

  /**
   * 載入 Excel 或 JSON 資料
   * @returns {Promise<Array>} - 解析後的資料陣列
   */
  async loadExcel() {
    try {
      let data = null;

      // 2. 特定期間內，優先從 GAS 獲取 JSON 數據
        if (CONFIG.GAS_DATA_URL && this._isInDateRange()) {
          try {
            const response = await fetch(`${CONFIG.GAS_DATA_URL}?t=${new Date().getTime()}`);
            const json = await response.json();
            data = Array.isArray(json) ? json : (json.data || []);
          } catch (e) {
            console.warn("從 GAS 載入即時資料失敗。頁面將顯示為無資料。", e);
          }
        }

        // 僅在特定期間外，才讀取 Excel
        if (!this._isInDateRange()) {
          if (typeof XLSX === 'undefined') {
            await this._loadXLSXLib();
          }
          const sheetName = "timeList";
          const response = await fetch(CONFIG.EXCEL_URL);
          const buffer = await response.arrayBuffer();
          const workbook = XLSX.read(buffer, { type: "array" });
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) {
            console.error(`Excel 檔案中找不到名為 '${sheetName}' 的工作表。將回傳空資料。`);
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
      return data || [];

    } catch (err) {
      console.error("資料載入錯誤:", err);
      return [];
    }
  }
}

/**
 * 任務資料處理器
 */
export class TaskDataProcessor {
  constructor(timeUtils, taskUtils) {
    this.timeUtils = timeUtils;
    this.taskUtils = taskUtils;
  }

  /**
   * 獲取需要顯示的任務類型列表
   * @returns {Array<object>}
   */
  getVisibleTaskTypes() {
    const visibleKeys = ["gishiki", "shirao", "sengen"];
    
    return TASK_TYPES.filter(type => visibleKeys.includes(type.key));
  }

  /**
   * 獲取指定星期的任務列表
   * @param {Array} rows - 資料來源
   * @param {object} type - 任務類型
   * @param {string} weekZh - 星期幾 (中文)
   * @returns {Array} - 排序後的任務列表
   */
  getTaskListForWeek(rows, type, weekZh) {
    return rows
      .filter(r => {
        // 1. 檢查 Week-zh 是否匹配 (標準)
        if (r["Week-zh"] === weekZh) return true;
        // 2. 檢查通用的 "Week" 欄位
        if (r["Week"] && r["Week"] === weekZh) return true;
        return false;
      })
      .filter(r => r[`${type.key}-time`])
      .map(r => {
        const timeResult = this.timeUtils.normalizeExcelTime(r[`${type.key}-time`]);
        
        return {
          time: timeResult.time,
          hasQuestionMark: timeResult.hasQuestionMark,
          zh: r[`${type.key}-zh`] || "",
          isNextDay: false
        };
      })
      .sort((a, b) => this.timeUtils.timeToMinutes(a.time) - this.timeUtils.timeToMinutes(b.time));
  }

  /**
   * 根據當前時間將任務分類 (前一個、當前、未來、剩餘)
   * @param {Array} list - 任務列表
   * @param {number} currentHour - 當前小時
   * @param {number} currentMinute - 當前分鐘
   * @returns {object} - 分類後的任務物件
   */
  categorizeTasksByTime(list, currentHour, currentMinute) {
    let currentItem = null;
    let previousItem = null;
    const nextItems = [];
    const remainingItemsToday = [];
    const remainingItemsTomorrow = [];

    // 偵測維護時段
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

        // 前一個時段的任務
        if (!item.isNextDay && !this.taskUtils.isMaintenanceTask(item)) {
          if (itemTotalMinutes >= halfHourStart && itemTotalMinutes <= halfHourEnd) {
            // 僅在當前時間未超過「任務時間 + 30分」時顯示
            const currentTotalMinutes = currentHour * 60 + currentMinute;
            const taskDeadlineMinutes = itemTotalMinutes + 30;
            
            if (currentTotalMinutes <= taskDeadlineMinutes) {
              previousItem = item;
            }
          }
        }

        // 目前的任務
        if (actualHour === currentHour) {
          currentItem = item;
        }
        // 接下來 2 小時的任務
        else if (actualHour === currentHour + 1 || actualHour === currentHour + 2) {
          nextItems.push(item);
        }
        // 今日剩餘的任務
        else if (actualHour > currentHour + 2 && !item.isNextDay && itemHour <= 23) {
          remainingItemsToday.push(item);
        }
        // 明日清晨的任務
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

  /**
   * 內部方法：獲取維護時段的小時集合
   * @param {Array} list - 任務列表
   * @returns {Set<number>} - 維護小時集合
   */
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

  /**
   * 內部方法：尋找當前時間對應的維護任務項目
   * @param {Array} list - 任務列表
   * @param {number} currentHour - 當前小時
   * @returns {object|null} - 維護任務項目
   */
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

  /**
   * 內部方法：分類非維護狀態下的任務 (下2小時、剩餘時間)
   */
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