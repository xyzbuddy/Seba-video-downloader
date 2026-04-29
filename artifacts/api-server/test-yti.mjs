import { Innertube, UniversalCache } from 'youtubei.js';
import { Jinter } from 'jintr';

async function test() {
  try {
    const yt = await Innertube.create({ 
      cache: new UniversalCache(false),
      fetch: async (input, init) => {
        // Optional proxying if needed, but lets just use native fetch for now
        return fetch(input, init);
      }
    });
    
    // Add custom jsruntime evaluating for deciphering
    yt.session.context.client.gl = 'US';
    yt.session.context.client.hl = 'en';

    // Register evaluator
    import('youtubei.js').then(({ Innertube }) => {
       // wait youtubei v17 default exported a different way?
    });
    
  } catch(e) { console.error(e); }
}

async function test2() {
  const yt = await Innertube.create({ generate_session_locally: true });
}
test2();
