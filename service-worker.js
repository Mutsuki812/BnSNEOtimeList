/* ==========================
   === 自毀型 Service Worker ===
   用於清除舊版快取並註銷 SW
   ========================== */

const CACHE_NAME = 'KILLER-SW';

self.addEventListener('install', (e) => {
  // 強制跳過等待，立即啟用新的 SW
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    // 1. 刪除所有舊有的快取 (無論名稱為何)
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        console.log('[Service Worker] 清除舊快取:', key);
        return caches.delete(key);
      }));
    }).then(() => {
      // 2. 接管頁面控制權
      return self.clients.claim();
    }).then(() => {
      // 3. 自我解除註冊
      // 這確保了下次使用者重新整理頁面時，瀏覽器不再受 SW 控制
      console.log('[Service Worker] 清理完成，自我解除註冊。');
      return self.registration.unregister();
    }).then(() => {
      // 4. 通知所有客戶端強制重新整理 (確保使用者立刻看到新版)
      return self.clients.matchAll().then(clients => {
        clients.forEach(client => client.navigate(client.url));
      });
    })
  );
});
