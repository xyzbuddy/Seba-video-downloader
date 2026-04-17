const url = "https://api.cobalt.tools/api/json";
fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "Accept": "application/json" },
  body: JSON.stringify({ url: "https://youtu.be/i6QekQlGd3s", vQuality: "1080", isAudioOnly: false })
})
.then(res => res.json())
.then(data => console.log(data))
.catch(err => console.error(err));
