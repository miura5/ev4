// The look pass's views and sizes (B-113, D-327). The views come from the page's own markup: every tab, and inside a
// tab every segment of its seg control, so a view added to the page gets its screenshots without a harness change.
// check.mjs holds the look pass to one screenshot per view per size (missingShots).
const SIZES = [
  [375, 667],
  [430, 932],
  [560, 830],
  [735, 830],
  [960, 1000],
  [1280, 800],
  [1470, 830],
  [1920, 1080],
  // B-203 (D-219): a third and a half of his 5120 x 1440 ultrawide, where E.V. lives most of the time.
  [1706, 1240],
  [2560, 1240],
].map(([width, height]) => ({
  width,
  height,
  tag: `${width}x${height}`,
  // B-204 (D-211): the theme each size is shot in, as the direction C canvases draw it: the phone and a third of the
  // ultrawide light, the rest dark. The contrast check covers both themes at every token whatever the shots show.
  scheme: width < 600 || width === 1706 ? 'light' : 'dark',
}));
// The shots to look at first (B-113, B-203, D-219): the phone, half the laptop, a third and a half of the ultrawide.
// B-621 (D-407): no 390 in the look pass; the phone is held to smoke's load-and-no-overflow check.
const FIRST = ['735x830', '1706x1240', '2560x1240'];
// B-297 (D-283): a view out of the switch, shot as he reaches it: today's review in Study's quiz card, from Today.
const QUIZ = { study: ['review'] };
function viewsOf(html) {
  const tabs = [...new Set([...String(html).matchAll(/data-tab="([a-z-]+)"/g)].map(m => m[1]))];
  const out = [];
  for (const tab of tabs) {
    const seg = String(html).match(new RegExp(`<div class="seg"[^>]*? id="seg-${tab}"[^>]*>([\\s\\S]*?)</div>`));
    const vs = seg ? [...seg[1].matchAll(/data-v="([a-z-]+)"/g)].map(m => m[1]) : [];
    if (!vs.length) out.push({ tab, v: null, id: tab });
    else for (const v of [...vs, ...(QUIZ[tab] || [])]) out.push({ tab, v, id: `${tab}-${v}` });
  }
  return out;
}
const shotName = (view, size) => `look-${view.id}-${size.tag}.png`;
/** The screenshots the look pass owes for this page that are not in the folder (at these size tags, or all). */
function missingShots(files, html, tags = null) {
  const have = new Set(files);
  return viewsOf(html)
    .flatMap(v => SIZES.filter(s => !tags || tags.includes(s.tag)).map(s => shotName(v, s)))
    .filter(f => !have.has(f));
}
module.exports = { SIZES, FIRST, viewsOf, shotName, missingShots };
