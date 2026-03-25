/* ==========================
   === Excel 資料處理 ===
   ========================== */

import { CONFIG, DATE_RANGES, TASK_TYPES } from './config.js';
import { TimeUtils, TaskUtils, SupabaseHelper } from './utils.js';

/**
 * Excel 資料讀取器
 */
export class ExcelDataLoader {
  constructor(timeUtils) {
    this.timeUtils = timeUtils;
  }

  /**
   * 載入任務資料 (改為從 Supabase 讀取)
   * @returns {Promise<Array>} - 解析後的資料陣列
   */
  async loadExcel() {
    try {
      // 初始化 Supabase
      const supabase = await SupabaseHelper.getClient();
      
      // 讀取 schedule_data 表格 (假設您將原本的 excel 資料匯入到此表)
      const { data, error } = await supabase
        .from('schedule_data')
        .select('*');

      if (error) {
        console.error("Supabase 查詢錯誤 (schedule_data):", error);
        throw error;
      }

      console.log("Supabase 資料載入成功，筆數:", data?.length);
      // 將資料庫回傳的寬表格資料轉換為系統可識別的長表格格式
      return this._transformData(data || []);

    } catch (err) {
      console.error("Supabase 資料載入流程發生錯誤:", err);
      return [];
    }
  }

  /**
   * 資料轉換：將 DB 欄位轉為內部格式
   * @param {Array} rows 
   */
  _transformData(rows) {
    const result = [];
    const weekMap = { '日': 7, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

    if (rows && rows.length > 0) {
      console.log("[Debug] DB 第一筆資料範例:", rows[0]);
      console.log("[Debug] DB 欄位列表:", Object.keys(rows[0]));
    }
    
    // 定義資料庫欄位對應到的任務類型 (支援小寫與駝峰)
    const typeMapping = {
      'gishikitime': 'gishiki',
      'shiraotime': 'shirao',
      'sengentime': 'sengen',
      'gishikiTime': 'gishiki',
      'shiraoTime': 'shirao',
      'sengenTime': 'sengen'
    };

    if (!Array.isArray(rows)) return [];

    rows.forEach(row => {
      // 1. 處理星期轉換
      // 優先讀取 week (小寫, DB欄位), 其次 Week (相容舊格式)
      let w = row['week'] || row['Week'];
      if (typeof w === 'string' && weekMap[w]) w = weekMap[w];
      else if (typeof w === 'string') w = parseInt(w, 10);

      // 2. 處理地點
      // 優先讀取 location (小寫, DB欄位)
      const loc = row['location'] || row['Location'] || "";

      // 3. 判斷資料格式 (長表格 vs 寬表格)
      // 檢查是否直接包含 type 與 time 欄位 (長表格格式)
      // 寬鬆檢查欄位名稱 (支援 type, Type, bossType, boss_type)
      const rawType = row['type'] || row['Type'] || row['bossType'];
      const rawTime = row['time'] || row['Time'];

      if (rawType && rawTime) {
        // --- 長表格處理邏輯 (DB 可能已經是 normalized 格式) ---
        // 嘗試正規化 type key
        let typeKey = String(rawType).toLowerCase();
        
        // 映射資料庫內容到系統內部 Key
        if (typeKey.includes('儀式') || typeKey.includes('gishiki')) typeKey = 'gishiki';
        else if (typeKey.includes('白青') || typeKey.includes('shirao')) typeKey = 'shirao';
        else if (typeKey.includes('仙幻') || typeKey.includes('sengen')) typeKey = 'sengen';

        result.push({
          week: w,
          type: typeKey,
          time: rawTime,
          location: loc
        });
      } else {
        // --- 寬表格處理邏輯 (原有邏輯，適用於從 Excel 直接匯入的結構) ---
        Object.keys(typeMapping).forEach(key => {
          if (row[key]) {
            result.push({
              week: w,
              type: typeMapping[key],
              time: row[key],
              location: loc
            });
          }
        });
      }
    });
    return result;
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
   * @param {string} week - 星期
   * @returns {Array} - 排序後的任務列表
   */
  getTaskListForWeek(rows, type, week) {
    return rows
      .filter(r => {
        // 檢查 week 是否匹配 (對應數字)，以及 type 是否符合目前類型
        const dbWeek = parseInt(r["week"], 10);

        return dbWeek === week && r["type"] === type.key;
      })
      .map(r => {
        const timeResult = this.timeUtils.normalizeExcelTime(r["time"]);
        
        return {
          time: timeResult.time,
          hasQuestionMark: timeResult.hasQuestionMark,
          content: r["location"] || "",
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