import { DOMHelper, StorageHelper, SupabaseHelper } from './utils.js';

export class UserManager {
  constructor() {
    this.storageKey = 'bnsneo_user';
    this.currentUser = StorageHelper.get(this.storageKey, null);
    this.modal = null;
    this.userInfoEl = document.querySelector('.userInfo');
    this.init();
  }

  async init() {
    // 應用程式啟動時，檢查本地儲存的使用者資訊是否仍然有效。
    // 如果本地有資料且 ID 存在，則去資料庫驗證該使用者是否仍然合法。
    // 若不合法（例如資料庫中該 ID 已不存在或名稱不符），則清除本地快取。
    if (this.currentUser && this.currentUser.id) {
      const isValid = await this.validateUserWithDB(this.currentUser);
      if (!isValid) {
        this.currentUser = null;
        StorageHelper.remove(this.storageKey);
      } else {
        this.updateLastOnline(this.currentUser.id);
      }
    }
    this.renderUserInfo();
  }

  getCurrentUser() {
    return this.currentUser;
  }
  /**
   * 驗證本地儲存的使用者資訊與資料庫是否一致。
   * 用於防止使用者在不同裝置上冒用他人身份。
   */
  // 驗證本地 User 與資料庫是否一致
  async validateUserWithDB(user) {
    try {
      const supabase = await SupabaseHelper.getClient();
      const { data, error } = await supabase
        .from('Users')
        .select('id, userName')
        .eq('id', user.id)
        .single();
      
      // 如果資料庫找不到該 ID，或找到的 userName 與本地不符，則視為無效。
      return !!(data && data.userName === user.userName);
    } catch (e) { return false; }
  }

  /**
   * 更新使用者的最後上線時間
   * @param {string} userId - 使用者 ID
   */
  async updateLastOnline(userId) {
    try {
      const supabase = await SupabaseHelper.getClient();
      const now = new Date().toISOString();
      console.log('[表單更新] 最後連線時間:', { userId, time: now });
      const { data, error } = await supabase
        .from('Users')
        .update({ last_online: now })
        .eq('id', userId)
        .select();
      
      if (error) {
        console.error('Supabase 更新 last_online 失敗:', error.message, error.details);
      } else if (!data || data.length === 0) {
        console.warn('Supabase 更新成功但無資料變動。這通常是因為 RLS 政策攔截，或是該 ID 不存在於 Users 表中。', { userId });
      } else {
        console.log('Supabase 更新 last_online 成功:', data[0]);
      }
    } catch (e) {
      console.error('更新最後上線時間失敗:', e);
    }
  }

  /**
   * 確保目前有登入的使用者。如果沒有，則彈出登入視窗。
   */
  async requireUser() {
    if (this.currentUser) return this.currentUser;
    
    return new Promise((resolve) => {
      this.showLoginModal((user) => {
        this.currentUser = user;
        StorageHelper.set(this.storageKey, user);
        this.renderUserInfo();
        resolve(user);
      }, () => {
        resolve(null); // User cancelled
      });
    });
  }

  /**
   * 渲染或更新使用者資訊區塊的 UI。
   */
  renderUserInfo() {
    if (!this.userInfoEl) return;
    if (this.currentUser) {
      this.userInfoEl.innerHTML = `
        <div class="user-info-content">
          <img src="./images/userC32.png" class="user-info-icon" alt="user">
          <span class="user-name-label">${this.currentUser.userName}</span>
          <span class="rename-btn" title="修改名稱">✎</span>
          <span class="logout-separator">|</span>
          <span class="logout-btn">登出</span>
        </div>
      `;
      this.userInfoEl.querySelector('.rename-btn').onclick = () => this.showRenameModal();
      this.userInfoEl.querySelector('.logout-btn').onclick = () => this.logout();
    } else {
      this.userInfoEl.innerHTML = `
        <div class="user-info-content unlogged">
          <img src="./images/user32.png" class="user-info-icon" alt="guest">
          <span class="login-btn">點擊登入</span>
        </div>
      `;
      this.userInfoEl.querySelector('.user-info-content.unlogged').onclick = () => this.requireUser();
    }
  }

  /**
   * 執行使用者登出操作。
   */
  logout(needConfirm = true) {
    const performLogout = () => {
      this.currentUser = null;
      StorageHelper.remove(this.storageKey);
      this.renderUserInfo();
      window.location.reload();
    };

    if (needConfirm) {
      this.showConfirmModal("確定要登出嗎？", performLogout);
    } else {
      performLogout();
    }
  }

  /**
   * 顯示一般使用者登入/註冊的彈窗。
   */
  showLoginModal(onSuccess, onCancel) {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');

    const box = DOMHelper.createElement('div', 'modal-box');

    box.innerHTML = `
      <h3>請輸入暱稱</h3>      
      <p>點擊回報按鈕左邊的時鐘可查看歷史紀錄</p>
      <p>僅用於刪除自己的回報紀錄或留言</p>
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

    const input = box.querySelector('#loginNameInput');
    const msg = box.querySelector('#loginMsg');
    const cancelBtn = box.querySelector('#loginCancelBtn');
    const confirmBtn = box.querySelector('#loginConfirmBtn');

    input.focus();

    const close = () => {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
      this.modal = null; 
    };

    cancelBtn.onclick = () => { close(); onCancel(); };

    const submit = async () => {
      const name = input.value.trim();
      if (!name) { msg.textContent = "請輸入名稱"; return; }
      
      msg.textContent = "登入中...";
      confirmBtn.disabled = true;
      input.disabled = true;

      try {
        const supabase = await SupabaseHelper.getClient();
        // 1. 檢查該名字是否已被註冊
        const { data: users } = await supabase.from('Users').select('id, userName, role').eq('userName', name);
        
        let user = (users && users.length > 0) ? users[0] : null;

        if (!user) {
          // 情況 A：新使用者，直接建立並儲存身分
          console.log('[表單新增] 新的使用者:', { userName: name });
          const { data: newUsers, error } = await supabase.from('Users').insert([{ userName: name }]).select('id, userName, role');
          if (error) throw error;
          user = newUsers[0];
        } else {
          // 情況 B：名字已存在。比對瀏覽器 localStorage 是否存有與資料庫相同的 ID。
          // 這是為了防止不同使用者在同一裝置上冒用已存在的名稱。
          const localData = StorageHelper.get(this.storageKey, null);
          if (!localData || localData.id !== user.id) {
            msg.textContent = "此名稱已被他人使用，請換一個。";
            confirmBtn.disabled = false;
            input.disabled = false;
            return;
          }
        }

        this.updateLastOnline(user.id);
        close(); onSuccess(user);
      } catch (e) { console.error(e); msg.textContent = "發生錯誤，請重試"; confirmBtn.disabled = false; input.disabled = false; }
    };
    confirmBtn.onclick = submit;
    input.onkeydown = (e) => { if(e.key === 'Enter') submit(); };
    overlay.onclick = (e) => { if(e.target === overlay) { close(); onCancel(); } };
  }

  /**
   * 顯示管理者登入的彈窗。
   */
  showAdminLoginModal() {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');
    const box = DOMHelper.createElement('div', 'modal-box');

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

    const nameInput = box.querySelector('#adminNameInput');
    const pwdInput = box.querySelector('#adminPwdInput');
    const msg = box.querySelector('#adminMsg');
    const confirmBtn = box.querySelector('#adminConfirmBtn');

    nameInput.focus();

    // 關閉彈窗的輔助函式
    const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); this.modal = null; };
    // 綁定取消按鈕事件
    box.querySelector('#adminCancelBtn').onclick = close;

    const submit = async () => {
      const name = nameInput.value.trim();
      const pwd = pwdInput.value.trim();
      if (!name || !pwd) { msg.textContent = "請完整輸入資訊"; return; }
      msg.textContent = "驗證權限中...";
      confirmBtn.disabled = true;

      try {
        const supabase = await SupabaseHelper.getClient();
        
        // 1. 檢查 Users 表單：確認名稱存在，並獲取其角色資訊。
        const searchName = name.trim();
        const { data: user, error: userErr } = await supabase
          .from('Users')
          .select('id, userName, role')
          .eq('userName', searchName)
          .maybeSingle();

        if (!user) {
          // 如果找不到使用者，則名稱錯誤。
          msg.textContent = "使用者名稱錯誤";
          confirmBtn.disabled = false;
          return;
        }

        // 檢查使用者角色是否為 'admin'。
        if (user.role !== 'admin') {
          msg.textContent = "權限不足 (非管理者身分)";
          confirmBtn.disabled = false;
          return;
        }

        // 2. 管理者登入只需要名字和密碼的確認即可，不驗證設備 ID
        const { data: info, error: infoErr } = await supabase
          .from('UserInfo')
          .select('password')
          .eq('userName', user.userName)
          .maybeSingle();

        if (infoErr || !info || String(info.password).trim() !== pwd) {
          // 如果讀取 UserInfo 失敗、找不到資訊或密碼不匹配，則驗證失敗。
          msg.textContent = "密碼驗證失敗";
          confirmBtn.disabled = false;
          return;
        }

        // 驗證成功：直接存入該管理者的正式 ID (這會自動更新此裝置的 localStorage)
        await this.updateLastOnline(user.id);
        this.currentUser = user;
        StorageHelper.set(this.storageKey, user);
        this.renderUserInfo();
        close();
        window.location.reload(); // 重新整理以載入管理者視圖
      } catch (e) {
        console.error(e);
        msg.textContent = "系統錯誤";
        confirmBtn.disabled = false;
      }
    };

    confirmBtn.onclick = submit;
    pwdInput.onkeydown = (e) => { if(e.key === 'Enter') submit(); };
  }

  /**
   * 顯示修改名稱的彈窗。
   */
  showRenameModal() {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');

    const box = DOMHelper.createElement('div', 'modal-box');

    box.innerHTML = `
      <h3>修改名稱</h3>
      <input type="text" id="renameInput" class="modal-input" value="${this.currentUser.userName}">
      <div id="renameMsg" class="modal-msg"></div>
      <div class="modal-btn-group">
        <button id="renameCancelBtn" class="btn-cancel">取消</button>
        <button id="renameConfirmBtn" class="btn-confirm">確定</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const input = box.querySelector('#renameInput');
    const msg = box.querySelector('#renameMsg');
    const cancelBtn = box.querySelector('#renameCancelBtn');
    const confirmBtn = box.querySelector('#renameConfirmBtn');

    input.focus();
    input.select();

    // 關閉彈窗的輔助函式
    const close = () => { 
      if (document.body.contains(overlay)) document.body.removeChild(overlay); 
      this.modal = null; 
    };

    cancelBtn.onclick = () => close();

    const submit = async () => {
      const newName = input.value.trim();
      if (!newName) { msg.textContent = "名稱不能為空"; return; }
      if (newName === this.currentUser.userName) { close(); return; }
      
      msg.textContent = "更新中...";
      confirmBtn.disabled = true;
      input.disabled = true;

      try {
        const supabase = await SupabaseHelper.getClient();
        // 檢查名稱是否重複
        const { data: existing } = await supabase.from('Users').select('id').eq('userName', newName);
        if (existing && existing.length > 0) {
          msg.textContent = "該名稱已被使用";
          confirmBtn.disabled = false;
          input.disabled = false;
          return;
        }

        console.log('[表單更新] 使用者名:', { id: this.currentUser.id, newName });
        const { error } = await supabase.from('Users').update({ userName: newName }).eq('id', this.currentUser.id);
        if (error) throw error;

        this.currentUser.userName = newName;
        StorageHelper.set(this.storageKey, this.currentUser);
        this.renderUserInfo();
        close();
      } catch (e) { 
        console.error(e); 
        msg.textContent = "發生錯誤，請重試"; 
        confirmBtn.disabled = false; 
        input.disabled = false; 
      }
    };
    confirmBtn.onclick = submit;
    input.onkeydown = (e) => { if(e.key === 'Enter') submit(); };
  }

  /**
   * 顯示通用確認彈窗。
   */
  showConfirmModal(message, onConfirm, isDanger = false) {
    if (this.modal) return;

    const overlay = DOMHelper.createElement('div', 'modal-overlay');

    const box = DOMHelper.createElement('div', 'modal-box');

    const btnText = isDanger ? '刪除' : '確定';
    const confirmBtnClass = isDanger ? 'btn-confirm danger' : 'btn-confirm';

    box.innerHTML = `
      <h3>確認</h3>
      <p class="modal-text">${message}</p>
      <div class="modal-btn-group">
        <button id="confirmCancelBtn" class="btn-cancel">取消</button>
        <button id="confirmOkBtn" class="${confirmBtnClass}">${btnText}</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.modal = overlay;

    const close = () => { if (document.body.contains(overlay)) document.body.removeChild(overlay); this.modal = null; };

    box.querySelector('#confirmCancelBtn').onclick = close;
    box.querySelector('#confirmOkBtn').onclick = () => { close(); onConfirm(); };
  }
}