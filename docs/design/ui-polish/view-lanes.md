# UI polish view lanes: what each view still has to convert (B-564 to B-572)

Read [LANES.md](LANES.md) first, along with the ev-builder skill. This file only lists, for each view, the leftovers that tonight's
moves kept on their old structure. The new look won't reach those parts by itself, so each view lane converts its own
on purpose, through Proprietary components or data-part. Sources: the lane reports in the Chart (B-509 to B-515),
docs/design/proprietary/cleanup-map.md and dryrun-report.md.

## Leftovers in every view
- Harness selectors still on visual classes (lane T): move each one to data-part when you add it. Never remove
  an old class that a harness still uses without moving its selector in the same commit.
- Component hooks: the view's JS builds through DS (data-ui at runtime). The static markup in index.src.html
  gets its data-ui from lane D2a.

## Today (B-564, B-565, B-566)
- Rows are DS.line (V1). The Done group (`grp ti-fold`) is still a hand-built fold; make it DS.fold, collapsed by
  default (B-565).
- Week cards carry data-key only. They need a pattern (week.css) and a load chip.
- Toolbar: one row, with the filter in a popover, List/Week, ‹ Today ›, Plan the rest and Add (D-393). Keep the day arrows.
- Harness classes to convert: `.ti-list`, `.ti-rest`, `.ti-review`, `.ti-fold`, `.ti-prop`, `.ti-off`.
- Behaviour that can start before the look: B-565 Done collapsed, and B-566 Start in the phone menu.

## Study (B-567, B-568)
- Cards are DS.card, and the plan and deck dialogs are DS.sheet (V2).
- Still hand-built: the plan settings popover `#plan-pop` and Triage's "Pick an objective" menu. These should become
  DS.popover. Keep B-455's checks green: the menu opens on screen and focused, and closes on a tap outside.
- Plan card inner parts: `.pl-day`, `.pl-t`, `.plan-sum`, `.pl-swap`, `.pl-foot`. Give them data-part. Use one button row with
  ⋯ (B-568), and let the title use the full width.
- The Practice sets table (B-567).

## Notes (B-569)
- Rows keep their old markup with data-part=row (V3). Line grew rows from 62 to 82 px, so convert them on purpose
  to the design's one-line rows.
- 107 Notes and Record rules stayed in legacy (lane C) and are moved in D2c. Check that each one landed.
- The style and course menus and the link box are hand-built: use DS.popover.
- Harness classes: `.n-pick`.

## Record (B-570)
- Opens on Notes (behaviour already started early).
- Rows use data-part=row, as in Notes. The detail pane stays.
- Harness classes: `.rec-day`, `.rec-title`, `.r`, `.nm`.

## Progress (B-571)
- Already on DS (the pilot). Day panel: a badge column, one-line titles, and a total that includes ticked minutes (B-522).
- The pilot used structural selectors (`#prog-day > p`); move them to data-part.

## Conversation and the E.V. window (B-572)
- Presence is in the header and sidebar (E1). The thread's Arc beside her newest message, Message (`.msg`, `.bubble`),
  the Resume chip (`.qchip`) and the composer moved in D1a/D2a; check what's left after D2c.
- Empty state: a greeting in the top third with Next up (D-393), and the composer anchored. Size the E.V. window to
  its content. The phone sheet comes from the ✦ line (D-393), at a baseline level only (D-394).
- Cards and sessions (D1b): plain buttons (energy, check fold, prep row, prep Add) become Button/Line/Fold.
- Harness classes: `.current`, `.greet`, `.bubble`, `.prep-*`, `.brief-line`.

## System
- Static `.card`, `.chip` and `.empty` in index.src.html get data-ui in D2a.
