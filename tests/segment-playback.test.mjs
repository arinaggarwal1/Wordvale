import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync(new URL('../src/lib/segmentPlayback.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { currentSegmentIndex, hasUsableSegmentTiming } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const segments = [{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 6 }];
test('highlights the segment at the current audio position and clears in gaps', () => {
    assert.equal(currentSegmentIndex(segments, 0), 0);
    assert.equal(currentSegmentIndex(segments, 1.5), 0);
    assert.equal(currentSegmentIndex(segments, 2), -1);
    assert.equal(currentSegmentIndex(segments, 3), 1);
    assert.equal(currentSegmentIndex(segments, 6), -1);
});
test('ignores missing and invalid timing', () => {
    assert.equal(hasUsableSegmentTiming({ start: -1, end: 2 }), false);
    assert.equal(hasUsableSegmentTiming({ start: NaN, end: 2 }), false);
    assert.equal(currentSegmentIndex(segments, NaN), -1);
});
