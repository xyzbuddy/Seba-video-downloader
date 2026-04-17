import https from "https";

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player";
const videoId = "i6QekQlGd3s";

const body = JSON.stringify({
  videoId,
  context: {
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.56.21",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12L",
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
    "User-Agent": "Mozilla/5.0 (Linux; Android 12; Oculus Quest 3) AppleWebKit/537.36 Chrome/114.0.0.0 Mobile Safari/537.36",
    "X-YouTube-Client-Name": "28",
    "X-YouTube-Client-Version": "1.56.21"
  },
  timeout: 10000
};

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
req.write(body);
req.end();
