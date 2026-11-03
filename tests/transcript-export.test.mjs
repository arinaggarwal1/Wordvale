import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../src/lib/transcriptExport.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { formatTranscript } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const original = { text: 'नमस्ते', srt: 'original srt', language: 'hi', segments: [{ id: 0, start: 3, end: 5, text: 'नमस्ते' }] };
const english = { text: 'Hello', srt: 'english srt', language: 'en', segments: [{ id: 0, start: 3, end: 5, text: 'Hello' }] };
const result = { file: 'talk.mp4', task: 'translate', duration_seconds: 8, ...original, original, english };

test('formats original and translated transcripts with distinct names', () => {
    assert.deepEqual(formatTranscript(result, 'original', 'text'), { filename: 'talk_original.txt', content: 'नमस्ते' });
    assert.deepEqual(formatTranscript(result, 'english', 'srt'), { filename: 'talk_english.srt', content: 'english srt' });
    assert.deepEqual(formatTranscript(result, 'original', 'timed'), { filename: 'talk_original.txt', content: '[0:03 - 0:05] नमस्ते' });
    assert.equal(JSON.parse(formatTranscript(result, 'english', 'json').content).view, 'english');
});

test('ASS export rejects missing and unreliable timing', () => {
    assert.throws(() => formatTranscript(result, 'original', 'ass'), /reliable word timestamps/);
    const variant = { ...original, ass: 'ass', segments: [{ ...original.segments[0], words: [{ word: 'x', timing_unreliable: true }] }] };
    assert.throws(() => formatTranscript({ ...result, original: variant }, 'original', 'ass'), /reliable word timestamps/);
});
