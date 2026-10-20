// The look pass's views and sizes (B-113, D-153). The views come from the page's own markup: every tab, and inside a
// tab every segment of its seg control, so a view added to the page gets its screenshots without a harness change.
// check.mjs holds the look pass to one screenshot per view per size (missingShots).
const SIZES = [[375, 667], [390, 844], [430, 932], [390, 450], [560, 830], [735, 830], [960, 1000], [1280, 800], [1470, 830], [1920, 1080]].map(([width, height]) => ({ width, height, tag: `${width}x${height}` }));
// The shots to look at first: the phone, half the laptop and the laptop (B-113).
const FIRST = ['390x844', '735x830', '1280x800'];
function viewsOf(html) {
  const tabs = [...new Set([...String(html).matchAll(/data-tab="([a-z-]+)"/g)].map(m => m[1]))];
  const out = [];
  for (const tab of tabs) {
    const seg = String(html).match(new RegExp(`<div class="seg" id="seg-${tab}"[^>]*>([\\s\\S]*?)</div>`));
    const vs = seg ? [...seg[1].matchAll(/data-v="([a-z-]+)"/g)].map(m => m[1]) : [];
    if (!vs.length) out.push({ tab, v: null, id: tab });
    else for (const v of vs) out.push({ tab, v, id: `${tab}-${v}` });
  }
  return out;
}
const shotName = (view, size) => `look-${view.id}-${size.tag}.png`;
/** The screenshots the look pass owes for this page that are not in the folder. */
function missingShots(files, html) {
  const have = new Set(files);
  return viewsOf(html).flatMap(v => SIZES.map(s => shotName(v, s))).filter(f => !have.has(f));
}
module.exports = { SIZES, FIRST, viewsOf, shotName, missingShots };
