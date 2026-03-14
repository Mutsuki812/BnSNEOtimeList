const cacheName = 'timeList-03141738'; // 版本
const cacheFiles = [
    './',
    './index.html',
    'style/common.css',
    './script/main.js',
  // 其他需要快取的資源
];

self.addEventListener('install', (event) => {
  console.log('[Service Worker] 安裝中...');
    event.waitUntil(
        caches.open(cacheName)
            .then((cache) => {
                console.log('[Service Worker] 快取檔案');
                return Promise.all(
                    cacheFiles.map(url => {
                        return fetch(url).then(response => {
                            if (!response.ok) {
                                console.warn(`[Service Worker] 無法快取 ${url}: 狀態 ${response.status}`);
                                return;
                            }
                            return response.blob().then(blob => {
                                return cache.put(url, new Response(blob, {
                                    status: 200,
                                    headers: response.headers
                                }));
                            });
                        }).catch(error => {
                            console.error(`[Service Worker] 抓取或快取 ${url} 時出錯:`, error);
                        });
                    })
                );
            })
            .then(() => {
                console.log('[Service Worker] 跳過等待');
                return self.skipWaiting();
            })
    );
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] 啟動中...');
  event.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== cacheName) {
                    console.log('[Service Worker] 移除舊快取', key);
                    return caches.delete(key);
                }
            }));
        })
            .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // 快取命中 - 直接回傳
                if (response) {
                    return response;
                }

                // 否則 - 抓取
                return fetch(event.request).then(
                    (response) => {
                        // 檢查是否為有效的 response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // IMPORTANT: 複製 response
                        const responseToCache = response.clone();

                        caches.open(cacheName)
                            .then((cache) => {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    }
                ).catch(error => {
                    console.error('[Service Worker] 抓取失敗:', error);
                    throw error;
                });
            })
    );
});

/*self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then(response => {
      //Cache hit - return response
      if (response) {
        console.log("cache hit")
        return response;
      }

      //Clone the request
      var requestToCache = event.request.clone();

      //fetch the request
      return fetch(requestToCache).then(
        function(response) {
          //Check if we received a valid response
          if(!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          //Clone the response
          var responseToCache = response.clone();

          caches.open(cacheName)
            caches.open(cacheName)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
  );
});*/