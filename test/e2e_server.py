# End-to-end: real server.js + fake providers + the real page in Chromium.
# Run: python3 test/e2e_server.py   (add --shots to save screenshots)
import asyncio, os, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = '--shots' in sys.argv
MOCK = 'http://127.0.0.1:9900'
PORT = 4300
failures = 0
def ok(cond, msg):
    global failures
    print(('  ✓ ' if cond else '  ✗ ') + msg)
    if not cond:
        failures += 1

def wait_http(url, t=10):
    end = time.time() + t
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except Exception as e:
            if hasattr(e, 'code'):
                return True
            time.sleep(0.1)
    return False

env = dict(os.environ)
for k in ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'REPLICATE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'POLLINATIONS_API_KEY', 'ACCESS_CODE', 'TEXT_PROVIDER']:
    env[k] = ''
env.update({'GEMINI_API_KEY': 'gk', 'FAL_KEY': 'fk', 'GEMINI_BASE_URL': MOCK, 'FAL_BASE_URL': MOCK + '/fal', 'PORT': str(PORT), 'HOST': '127.0.0.1'})
mock = subprocess.Popen(['node', 'test/run_mock.mjs'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
server = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

VENDOR = {
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs': ROOT + '/test/vendor/pdf.min.mjs',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs': ROOT + '/test/vendor/pdf.worker.min.mjs',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js': ROOT + '/test/vendor/jszip.min.js',
}

async def main():
    assert wait_http(MOCK + '/x') and wait_http('http://127.0.0.1:%d/api/health' % PORT), 'servers did not start'
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
        # bypass_csp only lets the test's wait_for_function strings run; the page's own CSP is checked by test_server.mjs.
        ctx = await b.new_context(viewport={'width': 1280, 'height': 900}, bypass_csp=True)
        async def vendor(route):
            path = VENDOR.get(route.request.url.split('?')[0])
            if path:
                await route.fulfill(path=path, content_type='text/javascript')
            else:
                await route.abort()
        await ctx.route('https://cdn.jsdelivr.net/**', vendor)
        await ctx.route('https://cdnjs.cloudflare.com/**', vendor)
        await ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        await ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        page = await ctx.new_page()
        errs = []
        page.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await page.goto('http://127.0.0.1:%d/' % PORT)
        await page.wait_for_function("document.getElementById('aiPillText').textContent.includes('Gemini')")
        print('Server mode')
        pill = await page.text_content('#footAi')
        ok('Gemini' in pill and '2 image + 3 video' in pill, 'footer: ' + pill)
        cards = await page.eval_on_selector_all('#imgEngines .engine', 'els => els.map(e => e.dataset.key + (e.getAttribute("aria-checked") === "true" ? "*" : ""))')
        ok(cards[:2] == ['fal:flux-schnell*', 'fal:seedream'] and 'local:vector' in cards, 'real engines first, built-ins after: %s' % cards)
        theme = await page.is_visible('#themeBtn')
        ok(theme, 'theme switch shown outside the artifact')
        await page.fill('#imgPrompt', 'a lighthouse at dawn')
        await page.click('#imgRatios button[aria-label^="Wide"]')
        await page.click('#imgGo')
        await page.wait_for_function("window.Alembic.app.Img.history.length === 1", timeout=20000)
        im = await page.evaluate("({ id: window.Alembic.app.Img.current.engineId, mime: window.Alembic.app.Img.current.mime, w: document.querySelector('#imgMedia img').naturalWidth })")
        ok(im['id'] == 'fal:flux-schnell' and im['mime'] == 'image/png' and im['w'] > 0, 'fal image shown: %s' % im)
        # seedream locks out nothing; check ratio list for cloudflare flux would be square only (not configured here)
        await page.click('#tab-video')
        vcards = await page.eval_on_selector_all('#vidEngines .engine', 'els => els.map(e => e.dataset.key)')
        ok(vcards[:3] == ['fal:grok-video', 'fal:seedance-2', 'fal:veo-3.1-fast'], 'video engines: %s' % vcards[:4])
        hidden = await page.evaluate("document.getElementById('vidMusicField').hidden")
        ok(hidden, 'soundtrack picker hidden for real models (they make their own sound)')
        durs = await page.eval_on_selector_all('#vidDurations button', 'els => els.map(e => e.textContent)')
        ok(durs == ['6 s', '10 s', '15 s'], 'grok durations: %s' % durs)
        await page.click('#vidEngines .engine[data-key="fal:veo-3.1-fast"]')
        ratios = await page.eval_on_selector_all('#vidRatios button', 'els => els.map(e => e.textContent + (e.disabled ? "(off)" : ""))')
        ok(ratios == ['16:9', '9:16', '1:1(off)'], 'veo ratios: %s' % ratios)
        await page.fill('#vidPrompt', 'waves at sunset')
        await page.click('#vidGo')
        await page.wait_for_selector('#vidSteps span.on', timeout=5000)
        steps = await page.text_content('#vidSteps')
        ok('Queued' in steps and 'Generating' in steps, 'job steps shown: ' + steps)
        await page.wait_for_function("window.Alembic.app.Video.history.length === 1", timeout=30000)
        v = await page.evaluate("({ id: window.Alembic.app.Video.current.engineId, size: window.Alembic.app.Video.current.blob.size, audio: window.Alembic.app.Video.current.extras.audio })")
        ok(v['id'] == 'fal:veo-3.1-fast' and v['size'] > 1000 and v['audio'], 'fal video downloaded: %s' % v)
        # Stop a real-model job: the server cancels it at fal.ai, and the last clip stays on stage
        await page.click('#vidEngines .engine[data-key="fal:seedance-2"]')
        await page.fill('#vidPrompt', 'slow please: waves at night')
        await page.click('#vidGo')
        await page.wait_for_selector('#vidSteps span.on', timeout=5000)
        await page.wait_for_timeout(1200)
        await page.click('#vidStop')
        try:
            await page.wait_for_selector('#toasts .toast:has-text("was told to cancel")', timeout=10000)
            back = await page.evaluate("({ n: window.Alembic.app.Video.history.length, busy: !document.getElementById('vidBusy').hidden, go: !document.getElementById('vidGo').disabled })")
            ok(back['n'] == 1 and not back['busy'] and back['go'], 'stop cancels the fal job and restores the studio: %s' % back)
        except Exception as e:
            ok(False, 'stop on a real engine: %s' % e)
        print('Summary with Gemini watching the video')
        await page.click('#tab-summary')
        await page.set_input_files('#fileInput', [ROOT + '/test/fixtures/clip.mp4'])
        await page.wait_for_selector('#sumActions .save-btn', timeout=30000)
        body = await page.inner_text('#sumBody')
        facts = await page.inner_text('#fileFacts')
        ok('watched video' in body and 'whole video + sound' in facts, 'video uploaded to Gemini and summarized: %s' % body[:60])
        await page.fill('#chatInput', 'What happens first?')
        await page.press('#chatInput', 'Enter')
        await page.wait_for_function("document.querySelectorAll('#chatLog .msg.ai .md').length === 1 && !document.querySelector('#chatLog .cursor') && !document.getElementById('chatSend').disabled", timeout=15000)
        ans = await page.inner_text('#chatLog .msg.ai')
        ok('watched video' in ans and '3 turns: user/model/user' in ans, 'chat reuses the upload and sends turns: ' + ans[:80])
        await page.click('#changeFile')
        await page.click('[data-sample="pdf"]')
        try:
            await page.wait_for_selector('#sumBody .md .cursor', timeout=15000)
            streamed = True
        except Exception:
            streamed = False
        await page.wait_for_selector('#sumActions .save-btn', timeout=30000)
        body = await page.inner_text('#sumBody')
        ok(streamed and 'gemini says hi' in body and 'thinking' not in body, 'pdf summary streams in through the server (cursor seen: %s)' % streamed)
        if SHOTS:
            await page.screenshot(path=ROOT + '/test/shots/server-summary.png')
        bad = [e for e in errs if 'net::' not in e and 'fonts.g' not in e]
        ok(not bad, 'no console errors: %s' % bad[:4])
        await b.close()

try:
    asyncio.run(main())
finally:
    server.terminate(); mock.terminate()
    out = server.communicate(timeout=5)[0].decode()
    if failures:
        print(out[-2000:])
print('\n%d FAILED' % failures if failures else '\nALL PASSED')
sys.exit(1 if failures else 0)
