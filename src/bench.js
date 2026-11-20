const t0 = performance.now();
const startedAt = performance.timeOrigin + t0;

const { existsSync } = await import('node:fs');
const { readFile, writeFile } = await import('node:fs/promises');
const { execFile, spawn } = await import('node:child_process');
const { createRequire } = await import('node:module');
const { arch, platform, release } = await import('node:os');
const { dirname, join } = await import('node:path');
const { parseArgs, promisify } = await import('node:util');
const { startServer } = await import('./launcher.js');
const run = promisify(execFile);
const require = createRequire(import.meta.url);
const viewport = { width: 1280, height: 720 };

function findBrowser(chromium) {
  const windows = [process.env.ProgramW6432, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
  const candidates = {
    win32: windows.filter(Boolean).flatMap(folder => [
      join(folder, 'Google/Chrome/Application/chrome.exe'), join(folder, 'Microsoft/Edge/Application/msedge.exe'),
    ]),
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'],
  }[process.platform] ?? [];
  return [chromium.executablePath(), ...candidates].find(path => existsSync(path));
}

async function chromiumForBench() {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('Benchmark requires a graphical display. On Linux without a desktop, use xvfb-run.');
  }
  const { chromium } = await import('playwright');
  let executablePath = findBrowser(chromium);
  if (!executablePath) {
    const installer = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [installer, 'install', 'chromium', '--no-shell'], { stdio: ['ignore', 2, 2] });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('Playwright Chromium installation failed')));
    });
    executablePath = findBrowser(chromium);
    if (!executablePath) throw new Error('Chromium executable not found after installation');
  }
  return { chromium, executablePath };
}

async function browserPid(browser) {
  const session = await browser.newBrowserCDPSession();
  try {
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const id = processInfo.find(info => info.type === 'browser')?.id;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } finally {
    await session.detach();
  }
}

async function residentMb(pid) {
  if (process.platform === 'linux') {
    const data = await readFile(`/proc/${pid}/status`, 'utf8');
    const value = /^VmRSS:\s+(\d+)\s+kB/m.exec(data);
    return value ? Number(value[1]) / 1024 : null;
  }
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).WorkingSet64`], { windowsHide: true, timeout: 2000 });
    return Number(stdout.trim()) / 1024 ** 2;
  }
  const { stdout } = await run('ps', ['-o', 'rss=', '-p', String(pid)], { timeout: 2000 });
  return Number(stdout.trim()) / 1024;
}

async function measureMemory(browser) {
  const pid = await browserPid(browser).catch(() => null);
  let peak = null;
  let pending;
  function sample() {
    if (!pid || pending) return;
    pending = residentMb(pid).then(value => {
      if (Number.isFinite(value) && value > 0) peak = Math.max(peak ?? 0, value);
    }).catch(() => {}).finally(() => { pending = undefined; });
  }
  sample();
  const timer = setInterval(sample, 1000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await pending;
    return peak;
  };
}

function frameStats(frameTimes) {
  const frames = frameTimes.length;
  if (frames === 0) throw new Error('No complete rendered frames arrived inside the measurement window');
  const sorted = [...frameTimes].sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(frames * 0.01));
  const sum = values => values.reduce((result, value) => result + value, 0);
  return {
    avg_fps: 1000 * frames / sum(frameTimes),
    p1_low_fps: 1000 * k / sum(sorted.slice(-k)),
    frame_ms_p95: sorted[Math.ceil(frames * 0.95) - 1],
    frames,
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    seed: { type: 'string', default: '42' }, duration: { type: 'string', default: '30' }, out: { type: 'string' },
  } });
  const seed = Number(values.seed);
  const duration = Number(values.duration);
  if (!/^-?\d+$/.test(values.seed) || !Number.isSafeInteger(seed) || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('Expected integer --seed and positive --duration in seconds');
  }
  const { contract_version } = JSON.parse(await readFile(new URL('../game.contract.json', import.meta.url), 'utf8'));
  const { chromium, executablePath } = await chromiumForBench();
  const server = await startServer({ port: 0 });
  let browser;
  let stopMemory;
  let timeout;
  try {
    browser = await chromium.launch({ executablePath, headless: false, args: [
      '--window-size=1280,720', '--disable-gpu-vsync', '--disable-frame-rate-limit',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      ...(process.platform === 'linux' && !process.env.DISPLAY && process.env.WAYLAND_DISPLAY ? ['--ozone-platform=wayland'] : []),
    ] });
    stopMemory = await measureMemory(browser);
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.bringToFront();
    await page.goto(`http://127.0.0.1:${server.address().port}/?bench=1&seed=${seed}&duration=${duration}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.lanternBench || window.lanternBenchError), undefined, { timeout: 60000 });
    const sample = await Promise.race([
      page.evaluate(() => {
        if (window.lanternBenchError) throw new Error(window.lanternBenchError);
        return window.lanternBench;
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Timed out waiting for benchmark frames')), Math.min(2 ** 31 - 1, (duration + 30) * 1000));
      }),
    ]);
    const stats = {
      contract_version, ...frameStats(sample.frameTimes), load_ms: Math.max(0, sample.firstFrameAt - startedAt),
      peak_mem_mb: await stopMemory(), vsync_off: true, renderer: sample.renderer,
      os: `${platform()} ${release()} ${arch()}`,
    };
    stopMemory = undefined;
    const output = `${JSON.stringify(stats, null, 2)}\n`;
    if (values.out && values.out !== '-') await writeFile(values.out, output);
    else process.stdout.write(output);
  } finally {
    clearTimeout(timeout);
    await stopMemory?.();
    try { await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
