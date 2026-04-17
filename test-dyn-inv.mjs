async function fetchInvidious(videoId) {
  try {
    const listReq = await fetch("https://api.invidious.io/instances.json?sort_by=health");
    const list = await listReq.json();
    const urls = list
      .filter(i => i[1].type === "https" && i[1].api && i[1].cors)
      .map(i => i[1].uri)
      .slice(0, 5);
      
    console.log("Trying Invidious instances:", urls);
    
    const controller = new AbortController();
    const result = await Promise.any(
      urls.map(async (url) => {
        const res = await fetch(`${url}/api/v1/videos/${videoId}?fields=videoId,title,videoThumbnails,lengthSeconds,author,viewCount,adaptiveFormats,formatStreams`, {
          signal: controller.signal
        });
        if (!res.ok) throw new Error("not ok");
        const data = await res.json();
        if (!data.title) throw new Error("no title");
        return { data, source: url };
      })
    );
    
    controller.abort();
    return result;
  } catch(e) {
    console.error("All instances failed");
    return null;
  }
}

fetchInvidious("i6QekQlGd3s").then(r => {
  if(r) console.log("Success from:", r.source, "Title:", r.data.title);
  else console.log("Failed");
});
