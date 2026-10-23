// Turns raw voice takes into game references for the Mimicry pack.
// 1. Record each line from src/game/mimicry.json with any voice recorder.
// 2. Save each take as mimicry-takes/<id>.<wav|mp3|m4a|ogg|webm>, e.g. mimicry-takes/mm-ayyo.m4a
// 3. Run: node scripts/import-mimicry.mjs
// Lines without a take stay hidden from the game.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const MAX_SECONDS = 4.5;
const lines = JSON.parse(await readFile('src/game/mimicry.json', 'utf8'));
await mkdir('public/audio/mimicry', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage();
try {
  for (const line of lines) {
    const extension = ['wav', 'mp3', 'm4a', 'ogg', 'webm'].find(type => existsSync(`mimicry-takes/${line.id}.${type}`));
    if (!extension) {
      console.log(`${line.id}: no take yet, skipped`);
      continue;
    }
    const encoded = (await readFile(`mimicry-takes/${line.id}.${extension}`)).toString('base64');
    const samples = await page.evaluate(async ({ encoded, maxSeconds }) => {
      const context = new OfflineAudioContext(1, 1, 44100);
      const decoded = await context.decodeAudioData(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)).buffer);
      // Resample to 44.1 kHz mono so every reference has the same format.
      const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 44100), 44100);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const mono = (await offline.startRendering()).getChannelData(0);
      let peak = 0;
      for (const sample of mono) peak = Math.max(peak, Math.abs(sample));
      if (peak < 0.01) throw new Error('Silent take');
      const padding = 3528;
      const start = Math.max(0, mono.findIndex(sample => Math.abs(sample) > peak * 0.04) - padding);
      let end = mono.length - 1;
      while (end > start && Math.abs(mono[end]) < peak * 0.04) end--;
      const clip = mono.slice(start, Math.min(mono.length, end + padding, start + maxSeconds * 44100));
      for (let i = 0; i < clip.length; i++) {
        const fade = Math.min(1, i / 441, (clip.length - 1 - i) / 441);
        clip[i] *= fade * 0.89 / peak;
      }
      return Array.from(clip);
    }, { encoded, maxSeconds: MAX_SECONDS });
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
    wav.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((sample, i) => wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2));
    await writeFile(`public/audio/mimicry/${line.id}.wav`, wav);
    line.duration = samples.length / 44100;
    const warning = line.duration >= MAX_SECONDS - 0.01 ? ' (cut at the 4.5s limit; record a shorter take)' : '';
    console.log(`${line.id}: ${line.duration.toFixed(2)}s imported${warning}`);
  }
  await writeFile('src/game/mimicry.json', JSON.stringify(lines, null, 2) + '\n');
} finally { await browser.close(); }
