import ytdl from "@distube/ytdl-core";
async function test() {
  try {
    const info = await ytdl.getInfo("https://youtu.be/i6QekQlGd3s");
    console.log(info.videoDetails.title);
    console.log("Formats:", info.formats.length);
  } catch(e) {
    console.error(e.message);
  }
}
test();
