const ytdl = require('@distube/ytdl-core');

async function test() {
  try {
    const info = await ytdl.getInfo("https://youtu.be/I3N84NZuqRs");
    console.log(info.videoDetails.title);
    console.log("Formats:", info.formats.length);
  } catch(e) {
    console.error(e);
  }
}
test();
