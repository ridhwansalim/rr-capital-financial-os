import { precacheAndRoute } from 'workbox-precaching'

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  if (event.request.method === 'POST' && url.pathname === '/_share-target') {
    event.respondWith((async () => {
      try {
        const formData = await event.request.formData()
        const image = formData.get('image')
        
        if (image) {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('FinOS-Share', 1)
            request.onupgradeneeded = () => request.result.createObjectStore('shared-files')
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          
          const tx = db.transaction('shared-files', 'readwrite')
          tx.objectStore('shared-files').put(image, 'latest-image')
          await new Promise(resolve => tx.oncomplete = resolve)
        }
      } catch (err) {
        console.error('Share target interception failed:', err)
      }
      
      return Response.redirect('/', 303)
    })())
  }
})


// Listen for the "Update Now" click from ReloadPrompt
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
