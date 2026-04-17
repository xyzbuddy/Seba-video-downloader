import https from "https";
import http from "http";

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player";
const videoId = "i6QekQlGd3s"; // From user's screenshot!

const body = JSON.stringify({
  videoId,
  context: {
    client: {
      clientName: "IOS", // 5
      clientVersion: "19.29.1",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iOS",
      osVersion: "17.5.1",
      hl: "en",
      gl: "US"
    }
  }
});

const url = new URL(INNERTUBE_URL);
const options = {
  hostname: url.hostname,
  path: url.pathname,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "User-Agent": "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)",
    "X-YouTube-Client-Name": "5",
    "X-YouTube-Client-Version": "19.29.1",
  },
  timeout: 10000
};

console.log("Testing IOS Client...");
const req = https.request(options, (res) => {
  const chunks = [];
  res.on("data", (c) => chunks.push(c));
  res.on("end", () => {
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      console.log("Status:", data.playabilityStatus?.status);
      console.log(JSON.stringify(data).substring(0, 500));
    } catch(e) {
      console.error(e.message);
    }
  });
});
req.on("error", console.error);
req.on("timeout", () => {
  console.log("TIMEOUT");
  req.destroy();
});
req.write(body);
req.end();
