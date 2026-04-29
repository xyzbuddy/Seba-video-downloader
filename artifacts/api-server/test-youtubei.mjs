import { Innertube, UniversalCache } from 'youtubei.js';
import { Jinter } from 'jintr';

async function test() {
  try {
    const yt = await Innertube.create({ 
      cache: new UniversalCache(false),
      evaluator: (cmd) => new Jinter(cmd).evaluate()
    });
    
    // Disable logging warnings for youtubei
    const info = await yt.getInfo('i6QekQlGd3s');
    
    // Try to get a video format
    const format = info.chooseFormat({ type: 'video+audio', quality: 'best' });
    const url = format.decipher(yt.session.player);
    
    console.log('Deciphered URL:', url);
    const res = await fetch(url, {method: 'GET', headers: {'Range': 'bytes=0-1000'}});
    console.log('Stream GET:', res.status, res.headers.get('content-type'));
    
  } catch(e) { console.error('ERROR', e.message); }
}

test();
