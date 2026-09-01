/* ============================================================
   使用者管理器
   負責使用者的識別、登入、登出、改名、管理者驗證等功能。

   身份識別機制：
   - device_token：由 Supabase 資料庫產生的唯一裝置識別碼
   - 同時存放於 localStorage (storageKey) 與 Cookie (tokenKey)，確保長期有效
   - 登入時比對 device_token 防止冒用他人名稱

   Supabase 資料表：
   - Users：儲存使用者資訊 (id, userName, role, device_token, last_online)
   - UserInfo：儲存管理者密碼（僅管理者驗證時讀取）
   ============================================================ */

import { DOMHelper, StorageHelper, SupabaseHelper, CookieHelper } from "./utils.js";

/**
 * 使用者管理器，處理所有與使用者身份相關的邏輯。
 */
export class UserManager {
  /**
   * @param {import('./soundManager.js').SoundManager} soundManager - 音效管理器實例（用於解鎖音訊）
   */
  constructor(soundManager) {
    this.soundManager = soundManager;
    this.storageKey   = "bnsneo_user";         // localStorage 存放使用者資訊的鍵
    this.tokenKey     = "bnsneo_device_token"; // Cookie 存放設備 Token 的鍵
    this.currentUser  = null; // 當前已登入的使用者物件
    this.modal        = null; // 當前開啟的 Modal 參考（防止重複開啟）

    this.userInfoEl = document.querySelector(".userInfo");
    this.init();
  }

  // ============================================================
  // 初始化
  // ============================================================

  /**
   * 初始化使用者狀態。
   * 嘗試從 localStorage/Cookie 恢復登入狀態，並驗證其是否與資料庫一致。
   * 若驗證失敗（Token 不符），自動清除本地資料，視為未登入。
   */
  async init() {
    const localUser   = StorageHelper.get(this.storageKey, null);
    const deviceToken = CookieHelper.get(this.tokenKey) ?? localUser?.device_token ?? null;

    if (localUser && deviceToken) {
      localUser.device_token = deviceToken;
      this.currentUser       = localUser;
    }

    // 有本地資料時，向資料庫驗證 Token 有效性
    if (this.currentUser?.device_token) {
      const isValid = await this.validateUserWithDB(this.currentUser);
      if (!isValid) {
        // Token 失效或不符：清除本地資料，重置為未登入狀態
        this.currentUser = null;
        StorageHelper.remove(this.storageKey);
        CookieHelper.remove(this.tokenKey);
      } else {
        // 驗證成功：更新最後上線時間，並同步 Cookie 延長有效期
        this.updateLastOnline(this.currentUser.id);
        CookieHelper.set(this.tokenKey, this.currentUser.device_token);

        // 背景補 Anonymous Auth
        this.ensureAnonymousAuth(this.currentUser);
      }
    }

    this.renderUserInfo();
  }

  // ============================================================
  // 公開 API
  // ============================================================

  /**
   * 取得當前已登入的使用者物件。
   * @returns {object|null} - 使用者物件；未登入時回傳 null
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * 確保當前有已登入的使用者。
   * 若未登入，自動彈出登入 Modal 等待使用者操作。
   * 常用於「需要登入才能執行」的動作（如送出回報）。
   * @returns {Promise<object|null>} - 登入成功時回傳使用者物件；取消時回傳 null
   */
  async requireUser() {
    if (this.currentUser) return this.currentUser;

    return new Promise((resolve) => {
      this.showLoginModal(
        (user) => {
          this.currentUser = user;
          StorageHelper.set(this.storageKey, user);
          CookieHelper.set(this.tokenKey, user.device_token);
          this.renderUserInfo();
          resolve(user);
        },
        () => resolve(null) // 使用者取消登入
      );
    });
  }

  /**
   * 執行登出操作，可選擇是否先顯示確認提示。
   * @param {boolean} [needConfirm=true] - true 表示登出前先顯示確認 Modal
   */
  logout(needConfirm = true) {
    const performLogout = () => {
      this.currentUser = null;
      StorageHelper.remove(this.storageKey);
      CookieHelper.remove(this.tokenKey);
      this.renderUserInfo();
      window.location.reload();
    };

    if (needConfirm) {
      this.showConfirmModal("確定要登出嗎？", performLogout);
    } else {
      performLogout();
    }
  }

  // ============================================================
  // UI 渲染
  // ============================================================

  /**
   * 渲染或更新使用者資訊區塊 (.userInfo)。
   * - 已登入：顯示暱稱、改名按鈕、登出按鈕
   * - 未登入：顯示「點擊登入」按鈕
   */
  renderUserInfo() {
    if (!this.userInfoEl) return;

    if (this.currentUser) {
      this.userInfoEl.innerHTML = `
        <div class="user-info-content">
          <img src="./images/user32_c.png" class="user-info-icon" alt="已登入使用者圖示">
          <span class="user-name-label" title="點擊修改暱稱"></span>
          <span class="logout-btn">登出</span>
        </div>
      `;
      // 使用 textContent 安全地設置使用者名稱（防止 XSS）
      this.userInfoEl.querySelector(".user-name-label").textContent = this.currentUser.userName;
      this.userInfoEl.querySelector(".user-name-label").addEventListener("click", () => this.showRenameModal());
      this.userInfoEl.querySelector(".logout-btn").addEventListener("click", () => this.logout());
    } else {
      this.userInfoEl.innerHTML = `
        <div class="user-info-content unlogged">
          <img src="./images/user32_b.png" class="user-info-icon"
               data-icon-light="./images/user32_b.png" data-icon-dark="./images/user32_w.png">
        </div>
      `;
      this.userInfoEl.querySelector(".user-info-content.unlogged").addEventListener("click", () => this.requireUser());
    }
  }

  // ============================================================
  // 資料庫操作
  // ============================================================

  /**
   * 建立或取得 Supabase Anonymous Auth，
   * 並將 auth.uid() 綁定至 Users.auth_user_id。
   */
  async ensureAnonymousAuth(user) {
    try {
      const supabase = await SupabaseHelper.getClient();

      // 先確認目前是否已存在 Supabase Auth Session
      let {
        data: { session }
      } = await supabase.auth.getSession();

      // 沒有 Session 才建立 Anonymous Auth
      if (!session) {
        const { data, error } =
          await supabase.auth.signInAnonymously();

        if (error) {
          console.warn(
            "[Auth] Anonymous Auth 建立失敗：",
            error
          );
          return;
        }

        session = data.session;
      }

      const authUserId = session?.user?.id;

      if (!authUserId || !user?.id) {
        return;
      }

      // 已經是相同 UID，不需要再次 UPDATE
      if (user.auth_user_id === authUserId) {
        return;
      }

      const { error: updateError } = await supabase
        .from("Users")
        .update({
          auth_user_id: authUserId
        })
        .eq("id", user.id);

      if (updateError) {
        console.warn(
          "[Auth] auth_user_id 綁定失敗：",
          updateError
        );
        return;
      }

      // 更新前端目前保存的 User
      user.auth_user_id = authUserId;
      this.currentUser = user;

      StorageHelper.set(
        this.storageKey,
        user
      );

      console.log(
        "[Auth] Anonymous Auth 綁定完成：",
        authUserId
      );

    } catch (error) {
      console.warn(
        "[Auth] Anonymous Auth 初始化失敗：",
        error
      );
    }
  }
  
  /**
   * 向 Supabase 驗證本地儲存的使用者 Token 是否有效。
   * 同時更新本地快取的 role 等資訊（確保與資料庫同步）。
   * @param {object} user - 本地儲存的使用者物件（需含 device_token）
   * @returns {Promise<boolean>} - Token 有效且使用者名稱吻合時回傳 true
   */
  async validateUserWithDB(user) {
    try {
      const supabase = await SupabaseHelper.getClient();
      const { data, error } = await supabase
        .from("Users")
        .select("id, userName, device_token, role, auth_user_id")
        .eq("device_token", user.device_token)
        .single();

      if (data && data.userName === user.userName) {
        // Token 有效：更新本地快取（可能有 role 變更等）
        this.currentUser = data;
        StorageHelper.set(this.storageKey, data);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 更新 Supabase 中使用者的最後上線時間 (last_online)。
   * @param {string} userId - Users 資料表的 id 欄位值
   */
  async updateLastOnline(userId) {
    try {
      const supabase = await SupabaseHelper.getClient();
      const now      = new Date().toISOString();
      console.log("[使用者] 更新最後上線時間：", { userId, time: now });

      const { data, error } = await supabase
        .from("Users")
        .update({ last_online: now })
        .eq("id", userId)
        .select();

      if (error) {
        console.error("[使用者] 更新 last_online 失敗：", error.message);
      } else if (!data || data.length === 0) {
        console.warn("[使用者] 更新成功但無資料變動（可能是 RLS 政策攔截，或 ID 不存在）：", { userId });
      }
    } catch (e) {
      console.error("[使用者] 更新最後上線時間發生例外：", e);
    }
  }

  // ============================================================
  // Modal 視窗
  // ============================================================

  /**
   * 顯示一般使用者登入/註冊的 Modal。
   * 流程：
   * 1. 使用者輸入暱稱
   * 2. 查詢 Supabase 是否已有相同名稱
   *    - 不存在：新增使用者並登入
   *    - 存在且 Token 吻合：直接登入
   *    - 存在但 Token 不符：阻擋（防止冒用）
   *
   * @param {function} onSuccess - 登入成功後的回調，接收使用者物件
   * @param {function} onCancel  - 使用者取消時的回調
   */
  showLoginModal(onSuccess, onCancel) {
    if (this.modal) return;

    const overlay = DOMHelper.createElement("div", "modal-overlay");
    const box     = DOMHelper.createElement("div", "modal-box");

    box.innerHTML = `
      <h3>請輸入暱稱</h3>
      <p>點擊回報按鈕左邊的時鐘可查看歷史記録</p>
      <p>僅用於刪除自己的回報記録或留言</p>
      <input type="text" id="loginNameInput" class="modal-input" placeholder="輸入名稱...">
      <div id="loginMsg" class="modal-msg"></div>
      <div class="modal-btn-group">
        <button id="loginCancelBtn" class="btn-cancel">取消</button>
        <button id="loginConfirmBtn" class="btn-confirm">確定</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const input      = box.querySelector("#loginNameInput");
    const msg        = box.querySelector("#loginMsg");
    const cancelBtn  = box.querySelector("#loginCancelBtn");
    const confirmBtn = box.querySelector("#loginConfirmBtn");

    input.focus();

    const close = () => {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
      this.modal = null;
    };

    cancelBtn.addEventListener("click", () => { close(); onCancel(); });

    const submit = async () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = "請輸入名稱"; return; }

      msg.textContent      = "登入中...";
      confirmBtn.disabled  = true;
      input.disabled       = true;

      try {
        const supabase = await SupabaseHelper.getClient();

        // 查詢是否已有相同名稱的使用者
        const { data: users } = await supabase
          .from("Users")
          .select("id, userName, role, device_token, auth_user_id")
          .eq("userName", name);

        let user = users?.length > 0 ? users[0] : null;

        if (!user) {
          // 情況 A：新使用者 → 建立帳號
          console.log("[使用者] 建立新使用者：", { userName: name });
          const { data: newUsers, error } = await supabase
            .from("Users")
            .insert([{ userName: name }])
            .select("id, userName, role, device_token, auth_user_id")
          if (error) throw error;
          user = newUsers[0];
        } else {
          // 情況 B：名稱已存在 → 比對 Token
          // 只有瀏覽器持有「與資料庫不同的 Token」時才阻擋（防止冒用）
          // 若瀏覽器無 Token（currentToken 為空），代表是跨裝置或登出後重新登入，允許通過
          const currentToken = CookieHelper.get(this.tokenKey) ?? StorageHelper.get(this.storageKey, {})?.device_token;

          if (currentToken && user.device_token && currentToken !== user.device_token) {
            msg.textContent     = "此名稱已被他人使用，請換一個。";
            confirmBtn.disabled = false;
            input.disabled      = false;
            return;
          }
        }

        // 登入成功：寫入 Cookie、更新上線時間、呼叫回調
        CookieHelper.set(this.tokenKey, user.device_token);
        this.updateLastOnline(user.id);
        this.currentUser = user;
        // 背景建立 / 綁定 Anonymous Auth
        this.ensureAnonymousAuth(user);
        close();
        onSuccess(user);
      } catch (e) {
        console.error("[使用者] 登入發生例外：", e);
        msg.textContent     = "發生錯誤，請重試";
        confirmBtn.disabled = false;
        input.disabled      = false;
      }
    };

    confirmBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) { close(); onCancel(); } });
  }

  /**
   * 顯示修改暱稱的 Modal。
   * 使用者輸入新名稱後，更新 Supabase 與本地快取。
   */
  showRenameModal() {
    if (this.modal) return;

    const overlay = DOMHelper.createElement("div", "modal-overlay");
    const box     = DOMHelper.createElement("div", "modal-box");

    box.innerHTML = `
      <h3>修改暱稱</h3>
      <input type="text" id="renameInput" class="modal-input" placeholder="輸入新名稱...">
      <div id="renameMsg" class="modal-msg"></div>
      <div class="modal-btn-group">
        <button id="renameCancelBtn" class="btn-cancel">取消</button>
        <button id="renameConfirmBtn" class="btn-confirm">確定</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const input      = box.querySelector("#renameInput");
    const msg        = box.querySelector("#renameMsg");
    const cancelBtn  = box.querySelector("#renameCancelBtn");
    const confirmBtn = box.querySelector("#renameConfirmBtn");

    input.focus();

    const close = () => {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
      this.modal = null;
    };

    cancelBtn.addEventListener("click", close);

    const submit = async () => {
      const newName = input.value.trim();
      if (!newName) { msg.textContent = "請輸入名稱"; return; }
      if (newName === this.currentUser?.userName) { msg.textContent = "名稱未變更"; return; }

      msg.textContent      = "更新中...";
      confirmBtn.disabled  = true;

      try {
        const supabase = await SupabaseHelper.getClient();

        // 先確認新名稱是否已被他人使用
        const { data: existing } = await supabase
          .from("Users")
          .select("id")
          .eq("userName", newName);

        if (existing?.length > 0) {
          msg.textContent     = "此名稱已被使用，請換一個。";
          confirmBtn.disabled = false;
          return;
        }

        // 更新 Supabase
        const { error } = await supabase
          .from("Users")
          .update({ userName: newName })
          .eq("id", this.currentUser.id);

        if (error) throw error;

        // 更新本地快取
        this.currentUser.userName = newName;
        StorageHelper.set(this.storageKey, this.currentUser);
        this.renderUserInfo();
        close();
      } catch (e) {
        console.error("[使用者] 改名發生例外：", e);
        msg.textContent     = "發生錯誤，請重試";
        confirmBtn.disabled = false;
      }
    };

    confirmBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }

  /**
   * 顯示管理者專用登入 Modal（雙重驗證：使用者名稱 + 密碼）。
   * 驗證流程：
   * 1. 在 Users 資料表確認使用者名稱存在且 role 為 "admin"
   * 2. 在 UserInfo 資料表比對密碼
   * 3. 驗證通過後以管理者身份登入並重整頁面
   * 觸發方式：點擊頂部時間標籤中的隱藏觸發區域 (.admin-trigger)
   */
  showAdminLoginModal() {
    if (this.modal) return;

    const overlay = DOMHelper.createElement("div", "modal-overlay");
    const box     = DOMHelper.createElement("div", "modal-box");

    box.innerHTML = `
      <h3>管理者登入</h3>
      <div class="modal-form-group">
        <input type="text" id="adminNameInput" class="modal-input" placeholder="管理者名稱...">
        <input type="password" id="adminPwdInput" class="modal-input" placeholder="輸入密碼..." style="margin-top:10px;">
      </div>
      <div id="adminMsg" class="modal-msg"></div>
      <div class="modal-btn-group">
        <button id="adminCancelBtn" class="btn-cancel">取消</button>
        <button id="adminConfirmBtn" class="btn-confirm">驗證</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const nameInput  = box.querySelector("#adminNameInput");
    const pwdInput   = box.querySelector("#adminPwdInput");
    const msg        = box.querySelector("#adminMsg");
    const confirmBtn = box.querySelector("#adminConfirmBtn");

    nameInput.focus();

    const close = () => {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
      this.modal = null;
    };

    box.querySelector("#adminCancelBtn").addEventListener("click", close);

    const submit = async () => {
      const name = nameInput.value.trim();
      const pwd  = pwdInput.value.trim();
      if (!name || !pwd) { msg.textContent = "請完整輸入資訊"; return; }

      msg.textContent      = "驗證權限中...";
      confirmBtn.disabled  = true;

      try {
        const supabase = await SupabaseHelper.getClient();

        // 步驟 1：確認使用者存在且為管理者角色
        const { data: user } = await supabase
          .from("Users")
          .select("id, userName, role, device_token, auth_user_id")
          .eq("userName", name)
          .maybeSingle();

        if (!user) {
          msg.textContent     = "使用者名稱錯誤";
          confirmBtn.disabled = false;
          return;
        }
        if (user.role !== "admin") {
          msg.textContent     = "權限不足（非管理者身分）";
          confirmBtn.disabled = false;
          return;
        }

        // 步驟 2：從 UserInfo 資料表比對密碼
        const { data: info, error: infoErr } = await supabase
          .from("UserInfo")
          .select("password")
          .eq("userName", user.userName)
          .maybeSingle();

        if (infoErr || !info || String(info.password).trim() !== pwd) {
          msg.textContent     = "密碼驗證失敗";
          confirmBtn.disabled = false;
          return;
        }

        // 驗證成功：以管理者身份登入並重整頁面
        await this.updateLastOnline(user.id);
        this.currentUser = user;
        CookieHelper.set(this.tokenKey, user.device_token);
        StorageHelper.set(this.storageKey, user);
        this.renderUserInfo();
        // 背景建立 / 綁定 Anonymous Auth
        this.ensureAnonymousAuth(user);
        close();
        window.location.reload();
      } catch (e) {
        console.error("[管理者登入] 發生例外：", e);
        msg.textContent     = "系統錯誤，請稍後再試";
        confirmBtn.disabled = false;
      }
    };

    confirmBtn.addEventListener("click", submit);
    pwdInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  }

  /**
   * 顯示通用確認 Modal（是/否）。
   * 常用於危險操作前的二次確認（如登出、刪除）。
   * @param {string}   message    - 要顯示的確認訊息
   * @param {function} onConfirm  - 使用者點擊確定後的回調
   * @param {boolean}  [isDanger=false] - true 表示確認按鈕套用危險樣式（紅色）
   */
  showConfirmModal(message, onConfirm, isDanger = false) {
    if (this.modal) return;

    const overlay = DOMHelper.createElement("div", "modal-overlay");
    const box     = DOMHelper.createElement("div", "modal-box");

    box.innerHTML = `
      <p class="modal-confirm-text">${message}</p>
      <div class="modal-btn-group">
        <button id="confirmCancelBtn" class="btn-cancel">取消</button>
        <button id="confirmOkBtn" class="${isDanger ? "btn-danger" : "btn-confirm"}">確定</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const close = () => {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
      this.modal = null;
    };

    box.querySelector("#confirmCancelBtn").addEventListener("click", close);
    box.querySelector("#confirmOkBtn").addEventListener("click", () => { close(); onConfirm(); });
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  }
}
