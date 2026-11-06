# Browser test of the single-file page (dist/preview.html) with a stand-in for the
# Claude artifact runtime (sample + downloads). Run after `node tools/build_artifact.mjs`:
#   python3 test/ui_test.py            (add --shots to save screenshots to test/shots/)
import asyncio, functools, http.server, json, mimetypes, os, sys, threading
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = '--shots' in sys.argv
mimetypes.add_type('text/javascript', '.mjs')
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8781), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

INIT = r"""
window.ALEMBIC_LIB_URLS = { jszip: '/test/vendor/jszip.min.js', pdfjs: '/test/vendor/pdf.min.mjs', pdfjsWorker: '/test/vendor/pdf.worker.min.mjs' };
window.__saved = []; window.__calls = [];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="a"><stop offset="0" stop-color="#f0a"/><stop offset="1" stop-color="#0af"/></linearGradient></defs><rect width="1280" height="720" fill="url(#a)"/><circle cx="640" cy="360" r="200" fill="#ffd23f" onclick="alert(1)"/><image href="https://evil.example/x.png"/><script>alert(2)</script></svg>';
const PIXEL = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" shape-rendering="crispEdges"><rect width="64" height="64" fill="#1b1f3a"/><rect x="20" y="30" width="24" height="20" fill="#c0603a"/><polygon points="16,30 32,16 48,30" fill="#8b2f2f"/><rect x="28" y="40" width="8" height="10" fill="#3a2414"/><rect x="22" y="34" width="5" height="5" fill="#ffd36b"/><rect x="0" y="50" width="64" height="14" fill="#e8f0ff"/></svg>';
const BAD_GLSL = '```glsl\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  float x = 1;\n  fragColor = vec4(x);\n}\n```';
const GLSL = '```glsl\nvoid mainImage(out vec4 fragColor, in vec2 fragCoord) {\n  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;\n  vec3 sky = mix(vec3(0.98, 0.55, 0.3), vec3(0.2, 0.1, 0.4), clamp(uv.y + 0.5, 0.0, 1.0));\n  float sun = smoothstep(0.22, 0.2, length(uv - vec2(0.0, 0.05)));\n  vec3 col = sky + sun * vec3(1.0, 0.8, 0.4);\n  float wave = 0.02 * sin(uv.x * 20.0 + iTime * 2.0);\n  if (uv.y < -0.1 + wave) col = mix(vec3(0.05, 0.1, 0.3), col, 0.3);\n  col *= 1.0 - 0.3 * dot(uv, uv);\n  fragColor = vec4(pow(col, vec3(0.4545)), 1.0);\n}\n```';
const SCENE = { title: 'Fireflies', music: { mood: 'mystery', tempo: 70 }, background: { from: '#04121f', to: '#163a2e', angle: 180, glow: '#2b6' }, elements: [ { kind: 'stars', count: 80, color: '#fff' }, { kind: 'hills', y: 0.8, height: 0.2, color: '#0b2', color2: '#021' }, { kind: 'particles', count: 60, color: '#ffe680', size: 0.006, direction: 'up', speed: 0.1 } ] };
const STORY = { title: 'Seed to tree', music: { mood: 'upbeat', tempo: 110 }, scenes: [
  { caption: 'A tiny seed falls into the soil.', scene: SCENE },
  { caption: 'Rain comes, and a sprout appears.', scene: { background: { from: '#0b2a4a', to: '#3a7bd5', angle: 180 }, elements: [ { kind: 'particles', count: 120, color: '#cfe8ff', size: 0.004, direction: 'down', speed: 0.4 } ] } },
  { caption: 'Years later, a great tree shelters the village.', scene: { background: { from: '#ffb35c', to: '#ff5c8a', angle: 180 }, elements: [ { kind: 'sun', x: 0.5, y: 0.6, r: 0.2, color: '#ffd23f' }, { kind: 'hills', y: 0.7, height: 0.2, color: '#2b1846' } ] } } ] };
let shaderCalls = 0;
function answer(p, turns) {
  if (turns) return '**Neural networks** learn by adjusting weights. The lecture says this happens with *backpropagation* (page 1).';
  if (p.includes('Create an original illustration as one SVG')) return 'Here you go:\n' + SVG;
  if (p.includes('Create pixel art as one SVG')) return PIXEL;
  if (p.includes('demoscene artist')) return (++shaderCalls === 1) ? BAD_GLSL : GLSL;
  if (p.includes('has a problem in WebGL 2')) return GLSL;
  if (p.includes('Rewrite this idea')) return '"A fox in a mossy forest reading a glowing book, soft rain, warm lantern light"';
  if (p.includes('You summarize files accurately')) {
    if (p.includes('study notes')) return '## Overview\nNeural networks in brief.\n\n## Quick quiz\n1. What is a neuron?\nAnswer: A unit that sums inputs.\n2. What is ReLU?\nAnswer: max(0, x).';
    return '## TL;DR\nThis file explains the basics.\n\n## Key points\n- **Point one** with detail\n- Point two\n\n## Numbers and dates\n| Item | Value |\n|---|---|\n| Rows | 12 |';
  }
  return 'ok';
}
const sample = async (input, opts = {}) => {
  const turns = Array.isArray(input) ? input : null;
  const p = turns ? turns.map(t => t.content).join('\n') : String(input);
  window.__calls.push({ head: p.slice(0, 160), len: p.length, images: opts.images ? opts.images.length : 0, turns: turns ? turns.length : 0, cache: opts.cache, prompt: p.includes('You summarize') ? p : undefined });
  const text = answer(p, turns);
  // Stream in a few chunks, like the real runtime.
  if (opts.onText) {
    const n = 4;
    for (let i = 1; i <= n; i++) {
      await new Promise(r => setTimeout(r, 60));
      if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'cancelled' });
      opts.onText({ text: text.slice(0, Math.ceil(text.length * i / n)) });
    }
  } else await new Promise(r => setTimeout(r, 80));
  return { text, truncated: false };
};
sample.json = async (input, opts) => {
  const p = String(input);
  window.__calls.push({ json: true, head: p.slice(0, 120) });
  await new Promise(r => setTimeout(r, 80));
  return p.includes('story reel') ? STORY : SCENE;
};
sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20000000, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } });
const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size ?? data.byteLength ?? data.length }); (window.__blobs = window.__blobs || {})[filename] = data; return { status: 'saved' }; } };
window.claude = { use: async (name) => { await new Promise(r => setTimeout(r, 30)); return name === 'sample' ? sample : name === 'downloads' ? downloads : null; } };
"""

failures = 0
def ok(cond, msg):
    global failures
    print(('  ✓ ' if cond else '  ✗ ') + msg)
    if not cond:
        failures += 1

async def calls(page):
    return await page.evaluate('window.__calls')

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900}, device_scale_factor=1)
        await ctx.add_init_script(INIT)
        await ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        page = await ctx.new_page()
        errs = []
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        await page.goto('http://127.0.0.1:8781/dist/preview.html')
        await page.wait_for_function("document.getElementById('aiPillText').textContent.includes('Claude')")

        print('Image studio')
        if SHOTS:
            await page.screenshot(path=ROOT + '/test/shots/image-start-desktop.png')
        cards = await page.eval_on_selector_all('#imgEngines .engine', 'els => els.map(e => e.dataset.key + (e.getAttribute("aria-checked") === "true" ? "*" : ""))')
        ok(cards == ['local:vector*', 'local:shader', 'local:pixel'], 'built-in engines shown, first selected: %s' % cards)
        locked = await page.eval_on_selector_all('#imgLocked li', 'els => els.length')
        summary = await page.text_content('#imgMoreSummary')
        ok(locked == 10 and '10 more engines' in summary, 'locked real models listed: %s / "%s"' % (locked, summary))
        groups = await page.eval_on_selector_all('#imgLocked h4', 'els => els.map(e => e.textContent)')
        ok(any('fal.ai' in g and 'FAL_KEY' in g for g in groups), 'locked groups name the key: %s' % groups[:2])
        await page.fill('#imgPrompt', 'fox reading')
        await page.click('#imgEnhance')
        await page.wait_for_function("document.getElementById('imgPrompt').value.startsWith('A fox in a mossy')")
        ok(True, 'improve prompt rewrote the text')
        await page.click('#imgRatios button[aria-label^="Wide"]')
        await page.click('#imgGo')
        await page.wait_for_selector('#imgHistory button', timeout=20000)
        svg = await page.evaluate("window.Alembic.app.Img.current.extras.svg")
        ok('<script' not in svg and 'onclick' not in svg and 'evil' not in svg and 'width="1280"' in svg, 'vector SVG sanitized and sized')
        tag = await page.text_content('#imgTag')
        ok('Vector Illustrator' in tag and '16:9' in tag, 'stage tag: ' + tag)
        acts = await page.eval_on_selector_all('#imgActions button', 'els => els.map(e => e.textContent.trim())')
        ok('PNG' in acts and 'SVG' in acts and 'Make it move' in acts and 'Shader Painter' in acts, 'actions: %s' % acts)
        await page.click('#imgActions .save-btn')
        await page.wait_for_timeout(300)
        # Same prompt with the Pixel Artist (one-click "also try")
        await page.click('#imgActions .also button:has-text("Pixel Artist")')
        await page.wait_for_function("window.Alembic.app.Img.history.length === 2", timeout=20000)
        cur = await page.evaluate("({ id: window.Alembic.app.Img.current.engineId, note: window.Alembic.app.Img.current.extras.note, pixel: document.querySelector('#imgMedia img').classList.contains('pixel') })")
        ok(cur['id'] == 'local:pixel' and cur['pixel'] and 'pixels' in (cur['note'] or ''), 'pixel artist: %s' % cur)
        # Shader painter, with one compile error fixed by the AI
        await page.click('#imgEngines .engine[data-key="local:shader"]')
        await page.click('#imgGo')
        try:
            await page.wait_for_function("window.Alembic.app.Img.history.length === 3", timeout=30000)
            sh = await page.evaluate("({ id: window.Alembic.app.Img.current.engineId, size: window.Alembic.app.Img.current.blob.size, w: document.querySelector('#imgMedia img').naturalWidth })")
            fix = [c for c in await calls(page) if 'has a problem in WebGL 2' in c['head']]
            ok(sh['id'] == 'local:shader' and sh['size'] > 5000 and sh['w'] == 1280 and len(fix) == 1, 'shader painter rendered after one fix: %s' % sh)
        except Exception as e:
            ok(False, 'shader painter: %s' % e)
        if SHOTS:
            await page.screenshot(path=ROOT + '/test/shots/image-desktop.png')
        await page.click('#imgActions button:has-text("Make it move")')
        await page.wait_for_timeout(400)
        vstate = await page.evaluate("({ view: location.hash, prompt: document.getElementById('vidPrompt').value, engine: window.Alembic.app.Video.engineId })")
        ok(vstate['view'] == '#video' and vstate['prompt'].startswith('A fox') and vstate['engine'] == 'local:shader-film', 'make it move -> video studio: %s' % vstate)

        print('Video studio')
        vcards = await page.eval_on_selector_all('#vidEngines .engine', 'els => els.map(e => e.dataset.key)')
        ok(vcards == ['local:motion', 'local:shader-film', 'local:story'], 'video engines: %s' % vcards)
        await page.click('#vidEngines .engine[data-key="local:motion"]')
        await page.fill('#vidPrompt', 'fireflies over a lake')
        await page.click('#vidDurations button:has-text("4 s")')
        await page.click('#vidRatios button[aria-label^="Tall"]')
        music_visible = await page.is_visible('#vidMusicField')
        ok(music_visible, 'soundtrack choices shown for built-in engines')
        await page.click('#vidGo')
        await page.wait_for_function("document.getElementById('vidTag').textContent.startsWith('Recording')", timeout=15000)
        ok(True, 'live recording shown on stage')
        await page.wait_for_function("window.Alembic.app.Video.history.length === 1", timeout=30000)
        v1 = await page.evaluate("""(async () => { const it = window.Alembic.app.Video.current; const buf = new Uint8Array(await it.blob.arrayBuffer()); const s = new TextDecoder('latin1').decode(buf);
          return { ext: it.ext, size: it.blob.size, audio: it.extras.audio, mood: it.extras.mood, hasAudioTrack: /soun|OpusHead|A_OPUS|mp4a/.test(s), ratio: it.ratio }; })()""")
        ok(v1['size'] > 20000 and v1['audio'] and v1['mood'] == 'mystery' and v1['hasAudioTrack'] and v1['ratio'] == '9:16', 'motion clip with soundtrack: %s' % v1)
        cap = await page.text_content('#vidActions .stage-caption')
        ok('mystery soundtrack' in cap, 'caption: ' + cap)
        await page.click('#vidActions .save-btn')
        await page.wait_for_timeout(300)
        # Story reel, no music
        await page.click('#vidEngines .engine[data-key="local:story"]')
        durs = await page.eval_on_selector_all('#vidDurations button', 'els => els.map(e => e.textContent)')
        ok(durs == ['9 s', '12 s', '15 s'], 'story durations: %s' % durs)
        await page.click('#vidMusic button:has-text("Off")')
        await page.click('#vidGo')
        await page.wait_for_function("window.Alembic.app.Video.history.length === 2", timeout=40000)
        v2 = await page.evaluate("({ id: window.Alembic.app.Video.current.engineId, audio: window.Alembic.app.Video.current.extras.audio, caps: window.Alembic.app.Video.current.extras.captions, secs: window.Alembic.app.Video.current.seconds })")
        ok(v2['id'] == 'local:story' and not v2['audio'] and len(v2['caps']) == 3 and v2['secs'] == 9, 'story reel: %s' % v2)
        # Shader film
        await page.click('#vidEngines .engine[data-key="local:shader-film"]')
        await page.click('#vidDurations button:has-text("4 s")')
        await page.click('#vidMusic button:has-text("Epic")')
        await page.click('#vidGo')
        try:
            await page.wait_for_function("window.Alembic.app.Video.history.length === 3", timeout=40000)
            v3 = await page.evaluate("({ id: window.Alembic.app.Video.current.engineId, size: window.Alembic.app.Video.current.blob.size, mood: window.Alembic.app.Video.current.extras.mood })")
            ok(v3['id'] == 'local:shader-film' and v3['size'] > 10000 and v3['mood'] == 'epic', 'shader film: %s' % v3)
        except Exception as e:
            ok(False, 'shader film: %s' % e)
        if SHOTS:
            await page.screenshot(path=ROOT + '/test/shots/video-desktop.png')

        print('Summary')
        await page.click('#tab-summary')
        if SHOTS:
            await page.wait_for_timeout(400)
            await page.screenshot(path=ROOT + '/test/shots/summary-start-desktop.png')
        await page.click('[data-sample="pdf"]')
        try:
            await page.wait_for_selector('#sumBody .md h2', timeout=20000)
        except Exception:
            print('DEBUG body:', (await page.inner_text('#sumBody'))[:300], '| read:', await page.inner_text('#readLabel'), '| type:', await page.inner_text('#fileType'))
            print('DEBUG calls:', [c['head'][:60] for c in (await calls(page))[-4:]], errs[-5:])
            raise
        await page.wait_for_function("document.querySelector('#sumActions .save-btn')")
        facts = await page.eval_on_selector_all('#fileFacts dt', 'els => els.map(e => e.textContent)')
        title = await page.evaluate("(() => { const dt = [...document.querySelectorAll('#fileFacts dt')].find(d => d.textContent === 'Title'); return dt ? dt.nextElementSibling.textContent : ''; })()")
        ok('Pages' in facts and 'Words' in facts and title and title != 'PDF document', 'pdf facts: %s, title "%s"' % (facts, title))
        sp = [c for c in await calls(page) if c.get('prompt')]
        ok(len(sp) == 1 and '[Page 1]' in sp[0]['prompt'] and 'lecture-4-neural-networks.pdf' in sp[0]['prompt'], 'summary prompt has page markers and file name')
        ok(await page.locator('#sumBody .md table').count() == 1, 'markdown table rendered')
        await page.click('#modeTabs button:has-text("Study notes")')
        await page.wait_for_function("document.querySelector('#sumBody .md') && document.querySelector('#sumBody .md').textContent.includes('Quick quiz')", timeout=10000)
        await page.click('#modeTabs button:has-text("Summary")')
        await page.wait_for_function("document.querySelector('#sumBody .md').textContent.includes('TL;DR')")
        sp = [c for c in await calls(page) if c.get('prompt')]
        ok(len(sp) == 2, 'switching back to Summary used the cached answer (%d summary calls)' % len(sp))
        await page.click('#lengthSeg button:has-text("Short")')
        await page.wait_for_function("document.querySelector('#sumActions .save-btn')")
        sp = [c for c in await calls(page) if c.get('prompt')]
        ok(len(sp) == 3 and 'about 120 words' in sp[-1]['prompt'], 'length change re-asks with the new length')
        await page.select_option('#langSelect', 'Hindi')
        await page.wait_for_function("document.querySelector('#sumActions .save-btn')")
        sp = [c for c in await calls(page) if c.get('prompt')]
        ok('Write in Hindi' in sp[-1]['prompt'], 'language option reaches the prompt')
        await page.click('#sumActions .save-btn')
        await page.wait_for_timeout(300)
        # Chat
        await page.click('#chatSuggest button >> nth=0')
        await page.wait_for_function("document.querySelector('#chatLog .msg.ai .md') && !document.querySelector('#chatLog .cursor') && !document.getElementById('chatSend').disabled", timeout=10000)
        await page.fill('#chatInput', 'What is backprop?')
        await page.press('#chatInput', 'Enter')
        await page.wait_for_function("document.querySelectorAll('#chatLog .msg.ai .md').length === 2 && !document.querySelector('#chatLog .cursor')", timeout=10000)
        turns = [c['turns'] for c in await calls(page) if c.get('turns')]
        ok(turns == [3, 5], 'chat sends file context + history: %s' % turns)
        # XLSX: exact stats table
        await page.click('#changeFile')
        await page.click('[data-sample="xlsx"]')
        await page.wait_for_selector('#dataGlance:not([hidden]) table', timeout=20000)
        rows = await page.eval_on_selector_all('#dataTables tbody tr', 'els => els.length')
        sp = [c for c in await calls(page) if c.get('prompt')]
        ok(rows >= 3 and 'computed exactly by the app' in sp[-1]['prompt'], 'spreadsheet stats shown (%d rows) and sent to the AI' % rows)
        # DOCX
        await page.click('#changeFile')
        await page.click('[data-sample="docx"]')
        await page.wait_for_function("document.querySelector('#fileType').textContent.includes('Word')")
        await page.wait_for_selector('#sumActions .save-btn', timeout=20000)
        ok(True, 'docx summarized')
        # Image file: sent as a picture
        await page.click('#changeFile')
        await page.set_input_files('#fileInput', [ROOT + '/test/fixtures/photo.jpg'])
        await page.wait_for_selector('#sumActions .save-btn', timeout=20000)
        last = (await calls(page))[-1]
        ok(last.get('images') == 1, 'photo sent to the AI as an image')
        # Video file: frames
        await page.click('#changeFile')
        await page.set_input_files('#fileInput', [ROOT + '/test/fixtures/clip.mp4'])
        await page.wait_for_selector('#fileFrames:not([hidden]) figure', timeout=30000)
        await page.wait_for_selector('#sumActions .save-btn', timeout=20000)
        last = (await calls(page))[-1]
        warn = await page.text_content('#fileWarnings')
        ok(last.get('images') == 5 and 'cannot hear' in warn, 'video: 5 frames to the AI, preview warning shown')
        if SHOTS:
            await page.screenshot(path=ROOT + '/test/shots/summary-desktop.png', full_page=False)
        # Audio in the preview: explained
        await page.click('#changeFile')
        await page.set_input_files('#fileInput', [ROOT + '/test/fixtures/tone.wav'])
        await page.wait_for_selector('#sumBody .err-box', timeout=10000)
        msg = await page.text_content('#sumBody .err-box')
        ok('Gemini' in msg, 'audio explains it needs Gemini: ' + msg[:80])
        saved = await page.evaluate('window.__saved')
        names = [s['filename'] for s in saved]
        ok(any(n.endswith('.png') for n in names) and any(n.endswith('.mp4') or n.endswith('.webm') for n in names) and any(n.endswith('.md') for n in names), 'downloads: %s' % names)

        print('My creations')
        await page.reload()
        await page.wait_for_function("document.getElementById('aiPillText').textContent.includes('Claude')")
        await page.click('#tab-image')
        try:
            await page.wait_for_function("window.Alembic.app.Img.history.length === 3 && window.Alembic.app.Video.history.length === 3", timeout=10000)
            g = await page.evaluate("""({ cur: window.Alembic.app.Img.current && window.Alembic.app.Img.current.engineId,
              svg: !!window.Alembic.app.Img.history.find(i => i.engineId === 'local:vector').extras.svg,
              head: document.getElementById('imgGalleryHead').textContent, thumbs: document.querySelectorAll('#imgHistory button').length,
              vids: document.querySelectorAll('#vidHistory button').length, shown: document.querySelector('#imgMedia img').src.startsWith('blob:') })""")
            ok(g['cur'] == 'local:shader' and g['svg'] and g['thumbs'] == 3 and g['vids'] == 3 and g['shown'] and '3 images' in g['head'] and 'kept in this browser' in g['head'], 'creations survive a reload, newest on stage: %s' % g)
        except Exception as e:
            ok(False, 'creations survive a reload: %s' % e)
        if SHOTS:
            await page.wait_for_selector('#view-image:not([hidden])')
            await page.wait_for_timeout(400)
            await page.screenshot(path=ROOT + '/test/shots/gallery-desktop.png', full_page=True)
        await page.set_viewport_size({'width': 390, 'height': 844})
        await page.wait_for_timeout(300)
        overflow = await page.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        ok(not overflow, 'no horizontal scroll on a phone with My creations shown')
        if SHOTS:
            await page.locator('#imgGalleryHead').scroll_into_view_if_needed()
            await page.screenshot(path=ROOT + '/test/shots/gallery-mobile.png')
        await page.set_viewport_size({'width': 1280, 'height': 900})
        await page.click('#imgActions button:has-text("Delete")')
        n1 = await page.evaluate("window.Alembic.app.Img.history.length")
        await page.click('#toasts .toast-act:has-text("Undo")')
        n2 = await page.evaluate("window.Alembic.app.Img.history.length")
        await page.click('#imgActions button:has-text("Delete")')
        cur = await page.evaluate("window.Alembic.app.Img.current.engineId")
        ok(n1 == 2 and n2 == 3 and cur == 'local:pixel', 'delete, undo, delete again: %s → %s → %s, now showing %s' % (3, n1, n2, cur))
        await page.click('#imgGalleryHead button:has-text("Download all")')
        try:
            await page.wait_for_function("window.__blobs && window.__blobs['alembic-images.zip']", timeout=15000)
            files = await page.evaluate("(async () => Object.keys((await JSZip.loadAsync(window.__blobs['alembic-images.zip'])).files).sort())()")
            ok(len([f for f in files if f.endswith('.png')]) == 2 and 'prompts.md' in files and files[0].startswith('01-'), 'download all zips the creations with a prompts index: %s' % files)
        except Exception as e:
            ok(False, 'download all: %s' % e)
        await page.reload()
        await page.wait_for_function("window.Alembic.app.Img.history.length === 2", timeout=10000)
        await page.click('#tab-image')
        await page.click('#imgGalleryHead button:has-text("Clear")')
        await page.click('#imgGalleryHead button:has-text("Delete all")')
        st = await page.evaluate("({ n: window.Alembic.app.Img.history.length, head: document.getElementById('imgGalleryHead').hidden, tag: document.getElementById('imgTag').textContent })")
        await page.reload()
        await page.wait_for_function("window.Alembic.app.Video.history.length === 3", timeout=10000)
        after = await page.evaluate("window.Alembic.app.Img.history.length")
        ok(st['n'] == 0 and st['head'] and st['tag'] == 'Example' and after == 0, 'clear empties My creations for good, videos untouched: %s, %d after reload' % (st, after))

        # Mobile, dark
        m = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, color_scheme='dark', is_mobile=True, has_touch=True)
        await m.add_init_script(INIT)
        await m.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        mp = await m.new_page()
        mp.on('pageerror', lambda e: errs.append('PAGEERROR mobile ' + str(e)))
        await mp.goto('http://127.0.0.1:8781/dist/preview.html#summary')
        await mp.wait_for_function("document.getElementById('aiPillText').textContent.includes('Claude')")
        overflow = await mp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        ok(not overflow, 'no horizontal scroll on a phone (summary)')
        await mp.click('[data-sample="pdf"]')
        await mp.wait_for_selector('#sumActions .save-btn', timeout=20000)
        overflow = await mp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        ok(not overflow, 'no horizontal scroll with a summary open')
        if SHOTS:
            await mp.screenshot(path=ROOT + '/test/shots/summary-mobile-dark.png')
        await mp.goto('http://127.0.0.1:8781/dist/preview.html#image')
        await mp.wait_for_timeout(500)
        overflow = await mp.evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')
        ok(not overflow, 'no horizontal scroll on a phone (image)')
        if SHOTS:
            await mp.screenshot(path=ROOT + '/test/shots/image-mobile-dark.png')

        bad = [e for e in errs if 'fonts.g' not in e and 'ERR_FAILED' not in e and 'net::' not in e]
        ok(not bad, 'no console errors: %s' % bad[:5])
        await b.close()
    srv.shutdown()
    print('\n%d FAILED' % failures if failures else '\nALL PASSED')
    sys.exit(1 if failures else 0)

if SHOTS:
    os.makedirs(ROOT + '/test/shots', exist_ok=True)
asyncio.run(main())
