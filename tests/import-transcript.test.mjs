import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/importTranscript.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { importTranscript } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
test('imports SRT with seekable timing and text', () => {
    const result = importTranscript('clip.srt', '1\n00:00:01,250 --> 00:00:03,500\nHello there\n\n2\n00:00:04,000 --> 00:00:06,000\nGoodbye');
    assert.equal(result.segments[0].start, 1.25); assert.equal(result.segments[1].end, 6); assert.equal(result.text, 'Hello there\n\nGoodbye');
});
test('imports a plain text transcript and rejects invalid subtitles', () => {
    assert.equal(importTranscript('notes.txt', 'hello').text, 'hello');
    assert.throws(() => importTranscript('bad.srt', '1\n00:00:05,000 --> 00:00:02,000\nno'), /invalid duration/);
    assert.throws(() => importTranscript('bad.json', '{"invalid":1}'), /not a Wordvale transcript/);
});
