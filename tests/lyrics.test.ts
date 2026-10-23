import test from "node:test";
import assert from "node:assert/strict";
import { splitLyrics, timeLyrics } from "../src/game/lyrics";

test("cues split into words and hyphenated syllables", () => {
  assert.deepEqual(splitLyrics("ba-dum-TSS"), ["ba-", "dum-", "TSS"]);
  assert.deepEqual(splitLyrics("oh no... oh no..."), ["oh", "no...", "oh", "no..."]);
  assert.deepEqual(splitLyrics("മനസ്സിലായോ?"), ["മനസ്സിലായോ?"]);
});

test("lyric timing follows the loud part of the reference and covers it in order", () => {
  const shape = [0, 0, 0, 0, 1, 1, 1, 1, 0, 0];
  const parts = timeLyrics("ba-DOOOM", shape, 2);
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[0].startSeconds - 0.8) < 1e-9);
  assert.ok(Math.abs(parts[1].endSeconds - 1.6) < 1e-9);
  assert.ok(parts[0].endSeconds === parts[1].startSeconds);
  assert.ok(parts[1].endSeconds - parts[1].startSeconds > parts[0].endSeconds - parts[0].startSeconds);
});

test("without a waveform the lyrics spread over the whole clip", () => {
  const parts = timeLyrics("yes", [], 1.5);
  assert.deepEqual([parts[0].startSeconds, parts[0].endSeconds], [0, 1.5]);
});
