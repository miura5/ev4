// E.V. core's library (B-155, split from core.test.mjs with its section): course materials chunked by page, searched,
// cited and read the same way in the page and the pipelines (D-079); Canvas picks, Office text, uploads and OCR merge.
// All data is made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import EV from '../core/evcore.mjs';
import { makeLibrary } from '../core/library.mjs';
import { loadValidator } from '../core/schemas.mjs';
import { describeErrors } from '../core/validate.mjs';

const spec = JSON.parse(fs.readFileSync(new URL('../spec/ev.spec.json', import.meta.url)));
EV.configure(spec);
const validate = loadValidator();

function assertValid(w) {
  const r = validate(w.collection, w.data, { id: w.id });
  assert.ok(r.ok, describeErrors(`${w.collection}/${w.id}`, r));
}

test('B-155: the library is its own file, one factory, and E.V. core still exports every name it did', () => {
  const src = fs.readFileSync(new URL('../core/library.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'no imports: it runs in the page as written');
  assert.deepEqual(src.match(/^export .*/gm), ['export function makeLibrary(core) {']);
  const core = fs.readFileSync(new URL('../core/evcore.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(core, /function searchLibrary|function libraryChunks|function readMaterial/, 'moved, not copied');
  for (const n of [
    'searchLibrary',
    'citeMaterial',
    'readMaterial',
    'libraryChunks',
    'libraryIndex',
    'liveMaterials',
    'normCourse',
  ])
    assert.equal(typeof EV[n], 'function', n);
  assert.equal(typeof makeLibrary, 'function');
});

// ---------------------------------------------------------------- library, with removal in materialedits
test('library: chunks keep their page, search ranks the right passage, read continues by page (D-079)', () => {
  const mats = [
    {
      id: 'NUR112-1',
      title: 'Ch 42 - Fluid, Electrolyte, and Acid-Base Balance.pdf',
      course: 'NUR 112',
      exam: 'E4',
      text: '[p1] Fluid balance overview. Body water compartments.\n[p2] Hypokalemia: potassium below 3.5 mEq/L causes muscle weakness and dysrhythmias.\n[p3] Hyperkalemia: peaked T waves.',
    },
    {
      id: 'NUR112-2',
      kind: 'lab',
      title: 'SKILLS PACKET',
      course: 'NUR 112',
      text: '[p1] Head-to-toe assessment. Perform hand hygiene. Verify two identifiers.\n[p2] Auscultate heart sounds at five landmarks: aortic, pulmonic, Erb point, tricuspid, mitral.',
    },
    {
      id: 'BIO201-9',
      kind: 'slides',
      title: 'Chapter 7 ppt',
      course: 'BIO 201',
      text: '[s1] Bones of the skull / Frontal bone\n[s2] Vertebral column',
    },
    { id: 'gone', title: 'Removed', text: 'potassium potassium' },
  ];
  const removal = EV.materialRemove(null, { now: '2026-10-18T01:00:00Z' });
  assertValid({ op: 'set', collection: 'materialedits', id: 'gone', data: removal });
  const lib = EV.liveMaterials(mats, [{ id: 'gone', ...removal }]);
  assert.deepEqual(
    lib.map(m => m.id),
    ['NUR112-1', 'NUR112-2', 'BIO201-9']
  );
  assert.equal(
    EV.liveMaterials(mats, [
      { id: 'gone', ...EV.materialRemove({ id: 'gone', ...removal }, { removed: false, now: '2026-10-18T02:00:00Z' }) },
    ]).length,
    4,
    'put back'
  );
  const chunks = EV.libraryChunks(EV.liveMaterials(mats, [{ id: 'gone', ...removal }]));
  assert.ok(chunks.every(c => c.id !== 'gone'));
  assert.equal(
    EV.libraryChunks([{ ...mats[3], removed: removal.removed }]).length,
    0,
    'a removed view is skipped even unfiltered'
  );
  assert.equal(chunks.find(c => /peaked/.test(c.text)).page, 3);
  const idx = EV.libraryIndex(chunks);
  let hits = EV.searchLibrary(idx, 'low potassium weakness');
  assert.equal(hits[0].id, 'NUR112-1');
  assert.equal(hits[0].page, 2);
  hits = EV.searchLibrary(idx, 'auscultating heart sound landmarks');
  assert.equal(hits[0].id, 'NUR112-2');
  assert.equal(hits[0].page, 2);
  assert.equal(hits[0].kind, 'lab');
  assert.equal(EV.citeMaterial(hits[0]), 'SKILLS PACKET, p. 2');
  assert.equal(EV.citeMaterial(EV.searchLibrary(idx, 'vertebral column')[0]), 'Chapter 7 ppt, slide 2');
  assert.equal(EV.searchLibrary(idx, 'skull bones', { course: 'NUR 112' }).length, 0);
  assert.equal(EV.searchLibrary(idx, 'skull bones', { course: 'BIO 201' })[0].page, 1);
  assert.deepEqual(EV.searchLibrary(idx, 'the of and'), []);
  // hyperkalemia and hyperglycemia must not collide
  assert.notEqual(EV.libStem('hyperkalemia'), EV.libStem('hyperglycemia'));
  const cat = EV.libraryCatalog(lib);
  assert.equal(cat.length, 3);
  assert.deepEqual(
    cat.map(c => c.kind),
    ['slides', 'lab', 'slides']
  );
  const r = EV.readMaterial(mats[0], { page: 2, maxChars: 90 });
  assert.ok(r.text.startsWith('[p2] Hypokalemia'));
  assert.equal(r.more, true);
  assert.equal(r.next, 3);
  assert.equal(EV.readMaterial(mats[0], { page: 3 }).more, false);
  // Files read before D-079 mark pages as [Page N]
  const legacy = {
    id: 'old',
    title: 'Ch 30 - Health Assessment.pdf',
    text: '[Page 1] Inspection first. [Page 2] Palpation of the abdomen comes last; auscultate bowel sounds before palpating.',
  };
  const lh = EV.searchLibrary(EV.libraryIndex(EV.libraryChunks([legacy])), 'auscultate bowel sounds');
  assert.equal(EV.citeMaterial(lh[0]), 'Ch 30 - Health Assessment, p. 2');
  assert.ok(EV.readMaterial(legacy, { page: 2 }).text.startsWith('[Page 2]'));
});

test('library: Canvas picks by module rules and skips graded paperwork and videos', () => {
  const rules = {
    modules: [
      { course: 'NUR 112', module: '^lab/skills', kind: 'lab' },
      { course: 'NUR 112', module: '^clinical resources', kind: 'clinical' },
      { course: 'NUR 112', module: '^start here', kind: 'course', only: 'syllabus|calendar' },
    ],
    skipTitles: 'video|parking|template',
    skipSections: 'paperwork|judgment map|medications',
  };
  const mods = [
    {
      name: 'LAB/SKILLS Resources',
      items: [
        { type: 'File', content_id: 1, title: 'SKILLS PACKET.pdf' },
        { type: 'SubHeader', title: 'VITAL SIGNS' },
        { type: 'File', content_id: 2, title: 'Vital Signs Video' },
        { type: 'ExternalUrl', title: 'Practice' },
        { type: 'File', content_id: 3, title: 'Heart Sound Locations' },
      ],
    },
    {
      name: 'CLINICAL Resources',
      items: [
        { type: 'File', content_id: 4, title: 'Hospital Parking' },
        { type: 'File', content_id: 5, title: 'Clinical Plan & Objectives' },
        { type: 'SubHeader', title: 'Long Term Care Paperwork' },
        { type: 'File', content_id: 6, title: 'Data Prep Sheet.pdf' },
        { type: 'SubHeader', title: 'Clinical Judgment Map' },
        { type: 'File', content_id: 7, title: 'Map + Rubric.pdf' },
      ],
    },
    {
      name: 'Start Here',
      items: [
        { type: 'File', content_id: 8, title: 'Syllabus.pdf' },
        { type: 'File', content_id: 9, title: 'Policy Manual' },
        { type: 'File', content_id: 10, title: 'Intro.mp4' },
      ],
    },
    { name: 'Exam 1 Content', items: [{ type: 'File', content_id: 11, title: 'Ch 1.pdf' }] },
  ];
  const picked = EV.libraryPick('NUR 112', mods, rules);
  assert.deepEqual(
    picked.map(p => p.fileId),
    [1, 3, 5, 8]
  );
  assert.deepEqual(
    picked.map(p => p.kind),
    ['lab', 'lab', 'clinical', 'course']
  );
  assert.equal(picked[1].section, 'VITAL SIGNS');
  assert.deepEqual(EV.libraryPick('BIO 201', mods, rules), []);
  // The function is self-contained, so the Canvas fetch script can embed its source
  const copy = new Function('return ' + EV.libraryPick.toString())();
  assert.deepEqual(
    copy('NUR 112', mods, rules).map(p => p.fileId),
    [1, 3, 5, 8]
  );
});

test('library: Word and PowerPoint text with built-ins only', async () => {
  const docx = await EV.officeText(fs.readFileSync(new URL('./data/sample.docx', import.meta.url)));
  assert.equal(docx.fileType, 'docx');
  assert.match(
    docx.text,
    /^Head-to-Toe Assessment Checklist\nPerform hand hygiene & introduce yourself\.\nVerify the client with two identifiers\./
  );
  const pptx = await EV.officeText(fs.readFileSync(new URL('./data/sample.pptx', import.meta.url)));
  assert.equal(pptx.pages, 2);
  assert.equal(
    pptx.text,
    '[s1] Fluid balance / Isotonic fluids stay in the vessels\n[s2] Potassium / Hypokalemia causes muscle weakness < 3.5 mEq/L\n'
  );
  await assert.rejects(EV.officeText(new Uint8Array([1, 2, 3])), /not a \.docx or \.pptx/);
  // Read by ranges (a big deck from Canvas): only the zip directory and the slide XML are fetched
  const bytes = new Uint8Array(fs.readFileSync(new URL('./data/sample.pptx', import.meta.url)));
  const calls = [];
  const ranged = await EV.officeText({
    size: bytes.length,
    range: async (a, b) => {
      calls.push([a, b]);
      return bytes.slice(a, b);
    },
  });
  assert.equal(ranged.text, pptx.text);
  assert.equal(calls.length, 3); // the directory, then one range per slide
  const copy = new Function('return ' + EV.officeText.toString())();
  assert.equal((await copy(fs.readFileSync(new URL('./data/sample.pptx', import.meta.url)))).pages, 2);
});

test('library: uploads become materials written by the page; page images read by Claude merge back by page', () => {
  const now = '2026-10-18T01:00:00Z';
  const u = EV.materialFromUpload(
    {
      title: 'Head to toe checklist.pdf',
      text: '[p1] Head-to-toe: hand hygiene, identify client, inspect skin...\n[p2] ',
      fileType: 'pdf',
      pages: 2,
      ocrPages: [2],
    },
    { now, existingIds: ['up-2026-10-17-head-to-toe-checklist'] }
  );
  assert.equal(u.id, 'up-2026-10-17-head-to-toe-checklist-2');
  assert.equal(u.data.course, 'NUR 112');
  assert.equal(u.data.kind, 'upload');
  assert.deepEqual(u.data.ocr.pages, [2]);
  assert.equal(u.data.source, 'upload');
  assert.equal(u.data.writer, 'page');
  assert.ok(!('status' in u.data), 'removal lives in materialedits');
  assertValid({ op: 'set', collection: 'materials', id: u.id, data: u.data });
  assert.equal(
    EV.materialFromUpload({ title: 'Skull bones.jpg', text: 'Frontal bone, parietal bone, occipital bone' }, { now })
      .data.course,
    'BIO 201'
  );
  assert.throws(() => EV.materialFromUpload({ title: 'blank.pdf', text: '[p1] \n[p2] ' }, { now }), /no readable text/);
  const pages = EV.parseOcr(
    {
      pages: [
        { page: 2, text: 'Auscultate  heart' },
        { page: 9, text: 'not asked' },
      ],
    },
    [2]
  );
  assert.deepEqual(pages, { 2: 'Auscultate heart' });
  assert.equal(EV.mergeOcr('[p1] One\n[p2] \n[p3] Three\n', pages), '[p1] One\n[p2] Auscultate heart\n[p3] Three\n');
  assert.match(EV.ocrPrompt({ title: 'X', pages: [1, 2] }), /pages 1, 2 of "X"[\s\S]*\{"pages"/);
});

test('library: Canvas files keep kind, type and link; a read handout survives an image-only refetch', () => {
  const raw = {
    host: 'https://alabama.instructure.com',
    courses: { 'NUR 112': 199214 },
    files: [
      {
        course: 'NUR 112',
        courseId: 199214,
        fileId: 77,
        title: 'Handout.pdf',
        module: 'Exam 4 Content',
        kind: 'handout',
        fileType: 'pdf',
        updatedAt: 'v2',
        pages: 1,
        text: '[p1] ',
        needsOcr: true,
      },
    ],
  };
  const old = {
    id: 'NUR112-77',
    fileUpdatedAt: 'v1',
    text: '[p1] Erikson stages...',
    ocr: { by: 'Claude', at: '2026-10-17T00:00:00Z', pages: [1] },
  };
  const res = EV.normalizeCanvas(raw, { materials: [old] }, { now: '2026-10-18T01:00:00Z' });
  const m = res.materials[0].data;
  assert.equal(m.schema, 1);
  assert.equal(m.writer, 'canvas-sync');
  assert.equal(m.kind, 'handout');
  assert.equal(m.url, 'https://alabama.instructure.com/courses/199214/files/77');
  assert.equal(m.text, '[p1] Erikson stages...');
  assert.equal(m.ocr.stale, true);
  assertValid({ op: 'set', collection: 'materials', id: 'NUR112-77', data: m });
  const fresh = EV.normalizeCanvas(
    { ...raw, files: [{ ...raw.files[0], fileId: 78 }] },
    {},
    { now: '2026-10-18T01:00:00Z' }
  );
  assert.match(fresh.changes[0].text, /image-only: attach it in the conversation/);
});
