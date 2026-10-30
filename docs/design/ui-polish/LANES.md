# UI polish lanes: how the look and view lanes run (D-397)

This is the brief for every UI polish lane (B-539 to B-572). Load the `ev-builder` skill first, then read this file.
The design is in this folder; `r4.css` holds its exact values. The doc is
https://claude.ai/artifact/9w83U8c79EjxijPXqs9xKi. These are working rules, not a test loop: there are no extra
checks and no fix rounds (D-366, D-396).

## Order (never parallel across stages)
1. **Tokens lane (one lane, alone, first):** neutral themes, the kind palette, the type scale and the motion tokens.
   Port `r4.css` values **word for word** into page/ds/tokens.css and page/theme.js inputs. Don't re-derive values
   from the screenshots. `r4.css` is the spec; the PNGs only show what it should look like.
2. **Component lanes (up to 5 in parallel, after 1 lands):** one per component group, each owning its own
   `page/ds/components/NN-*.css` and `page/app/01-ui-NN-*.js` files:
   - badges and dots
   - Line rows and the flat check
   - buttons and symmetric groups
   - toast and working notice
   - meter and the quiet ✦ line
3. **One staging stop.** The build manager ships staging and looks once, so drift is caught while there's one place
   to fix it.
4. **View lanes (up to 9 in parallel):** one per view task.
   - Behaviour parts that don't depend on the look can start early: Record opens on Notes, the greeting with Next
     up, Done collapsed by default, Start in the phone menu, and the E.V. window sized to its content.

## Rules for every lane
- **Look changes live in tokens and components only** (D-380, D-382). No raw colour, size, space, radius or timing
  in a view file, and no one-screen override to "make it match".
- **One look before pushing.** Open the reference page (`/reference` on staging, or this folder locally) and your
  staging build side by side at 1280. It's a two-minute sanity look, not a pixel check (D-396).
- **The leftovers list.** Some views kept their old structure to stay pixel-identical: Notes and Record rows
  (data-part rows, not Line), the E.V. window's messages, thread flower, Resume chip and composer, the Today Done group
  and the Week cards. The new look won't reach them by itself. Each view lane converts its own leftovers on purpose.
  See the cleanup map and the lane reports in the Chart (B-510 to B-515 notes).
- **States the reference doesn't show** (dialogs, Week, a flashcard session, the quiz runner, empty states): ask
  the designer once, through the build manager, and build what it answers. Don't improvise per lane.
- **Keep:** the L-shaped frame (sidebar plus bottom strip, with the main window as a floating inset panel), Today's day
  arrows, and everything Matt uses (the plan criteria, Remake, Put away behind ⋯, Progress's period switch, Quiz
  accuracy and readiness, Record's detail pane).
- **Motion (D-394):** view switches stay instant. In-view elements reveal softly: folds by height and opacity,
  popovers and toasts fade and rise. Press is a colour change, never a scale.
- **Desktop at 1280 is the priority.** At 390 it must fit and work.
- **Done means** built through Proprietary and looking right on staging at 1280. Matching inaccuracies are fixed
  after release (D-396).
