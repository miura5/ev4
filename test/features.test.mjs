// B-18's new features in E.V. core: the readiness audit (per objective, with the passages to reread). The skills
// checklists it once tested are retired (D-416). Made-up text throughout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EV from '../core/evcore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
EV.configure(JSON.parse(fs.readFileSync(path.join(ROOT, 'spec/ev.spec.json'), 'utf8')));

test('readinessAudit: per objective, not-yet first, with the passages to reread cited by file and page', () => {
  const day = '2026-10-18';
  const w = (id, objective, topic, streak, status = 'open') => ({
    id,
    topic,
    objective,
    exam: 'E4',
    kind: 'concept',
    derived: { status, streak, preRead: false },
  });
  const weakspots = [
    w('a', 'E4-3', 'Hypokalemia findings', 0),
    w('b', 'E4-3', 'Fluid volume excess signs', 1),
    w('c', 'E4-7', 'Metformin teaching', 0),
    w('d', 'E4-7', 'Hypoglycemia signs', 0),
    w('e', 'E4-1', 'Mixing insulins', 2, 'reviewed'),
    w('f', 'E3-1', 'Heart sounds', 0),
  ];
  const objectives = [
    { id: 'E4-1', exam: 'E4', text: 'Insulin administration' },
    { id: 'E4-3', exam: 'E4', text: 'Fluids and electrolytes' },
    { id: 'E4-7', exam: 'E4', text: 'Diabetes care' },
    { id: 'E4-9', exam: 'E4', text: 'Nothing logged here' },
  ];
  const mats = [
    {
      id: 'NUR112-1',
      title: 'Ch 42 Fluids.pptx',
      course: 'NUR 112',
      kind: 'slides',
      text: '[s3] Hypokalemia findings: muscle weakness, flat T waves, cramps.\n[s4] Fluid volume excess signs: edema, crackles, bounding pulse.',
    },
    {
      id: 'NUR112-2',
      title: 'Ch 50 Diabetes.pdf',
      course: 'NUR 112',
      kind: 'slides',
      text: '[p7] Hypoglycemia signs: shaky, sweaty, confused. Metformin teaching: take with meals.',
    },
  ];
  const index = EV.libraryIndex(EV.libraryChunks(mats));
  const rows = EV.readinessAudit({ examId: 'E4', objectives, weakspots, index, date: day });
  assert.deepEqual(
    rows.map(r => [r.id, r.solid, r.rightOnce, r.notYet]),
    [
      ['E4-7', 0, 0, 2],
      ['E4-3', 0, 1, 1],
      ['E4-1', 1, 0, 0],
    ]
  );
  assert.deepEqual(rows[0].topics, ['Metformin teaching', 'Hypoglycemia signs']);
  assert.equal(rows[0].passages[0].cite, 'Ch 50 Diabetes, p. 7');
  assert.equal(rows[1].passages[0].cite, 'Ch 42 Fluids, slide 3');
  assert.deepEqual(rows[2].passages, [], 'a solid objective needs no rereading');
  assert.deepEqual(
    EV.readinessAudit({ examId: 'E4', objectives, weakspots }).map(r => r.passages.length),
    [0, 0, 0],
    'no index, no passages'
  );
});
