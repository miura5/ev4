# E.V. UX probe: motion and fine detail (an add-on to the tester brief)

Screenshots only show still frames. Matt wants you to actually see motion and the small details, so do this as well.

## Seeing motion
For each key interaction below, record what happens in the first 1.5–2 seconds after you tap and turn it into one image you can look at.
- Record with Playwright: `browser.newContext({ recordVideo: { dir, size: viewport } })`. Close the page so the .webm is written.
- Or take quick screenshots every ~100 ms right after the tap.
- Turn either into a contact sheet: `ffmpeg -i clip.webm -vf "fps=8,scale=iw/2:-1,tile=4x3" -frames:v 1 sheet.png` (ffmpeg and PIL are installed).
- Look at the sheet with Read.

Key interactions to film:
- switching views
- opening and closing the E.V. window
- a tick on Today
- revealing a flashcard and rating it
- answering a quiz question
- submitting a chat message, through to E.V.'s reply starting
- a long job's waiting state (plan or deck)
- opening a sheet or dialog, and a page loading cold

For each, note:
- **Response time:** how long after the tap something visibly changes. Under 100 ms feels instant; 300 ms or more feels laggy.
- **Transitions:** smooth, abrupt, or missing.
- **Layout shift and flicker:** content jumping as it loads.
- **Loading and waiting:** is there a sign that work is happening? Does it reassure you or feel stuck?
- **The avatar's animation:** does it say anything about E.V.'s state?
- **Phone:** whether the scroll position or keyboard jumps.

## Seeing fine detail
On a few screens per view, zoom in. Either screenshot with `deviceScaleFactor: 2` and crop regions with PIL, or use `page.screenshot({ clip })`, then look closely.
- Alignment and spacing rhythm.
- Icon sizes and weights against the text.
- Type hierarchy.
- Truncation and overflow of long titles.
- Contrast of quiet text.
- Hover, pressed and focus states (hover and focus with the keyboard at 1280).
- Disabled states.
- Empty states.
- Anything that looks unfinished or inconsistent between views.

## Record it
In findings.md, write a **Motion and detail** section with one row per observation:

| # | Where | Interaction / detail | What I saw (frames) | Felt like | Kind | Sheet/crop |

Kinds: `UI-motion`, `UI-detail`, `UX-feedback`. Severity uses the same gaps as before.

Add the worst 3 to your Top 10 if they qualify.

Keep the extra time sensible: about 30–40 minutes more on a full probe; on a delta probe, film only the interactions in the journeys you were given.
