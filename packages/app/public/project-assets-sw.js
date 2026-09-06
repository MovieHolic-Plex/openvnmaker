/* Own-project binary assets only. This worker never intercepts app/API/network requests. */
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=="GET" || url.origin!==self.location.origin || !/^\/assets\/user\/[a-f0-9]{64}\.(png|jpg|webp|mp3|ogg|wav)$/.test(url.pathname))return;
  event.respondWith(new Promise(resolve=>{
    const request=indexedDB.open("vnmaker.project-assets",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("files",{keyPath:"path"});
    const failure=()=>resolve(new Response("Project media unavailable",{status:404,headers:{"Content-Type":"text/plain"}}));
    request.onerror=failure;
    request.onsuccess=()=>{
      const db=request.result;
      const tx=db.transaction("files","readonly");
      const read=tx.objectStore("files").get(url.pathname);
      read.onsuccess=()=>{const asset=read.result;if(!asset?.blob)return failure();
        const blob=asset.blob,headers={"Content-Type":blob.type,"Content-Length":String(blob.size),"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Accept-Ranges":"bytes"};
        const range=event.request.headers.get("Range");
        if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);let start=0,end=blob.size-1;
          if(match&&(match[1]||match[2])){if(!match[1])start=Math.max(0,blob.size-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}}
          else start=blob.size;
          if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=blob.size||end<start){resolve(new Response(null,{status:416,headers:{"Content-Range":`bytes */${blob.size}`}}));return;}
          resolve(new Response(blob.slice(start,end+1),{status:206,headers:{...headers,"Content-Length":String(end-start+1),"Content-Range":`bytes ${start}-${end}/${blob.size}`}}));return;
        }
        resolve(new Response(blob,{headers}));};
      read.onerror=failure;tx.oncomplete=tx.onabort=()=>db.close();
    };
  }));
});
