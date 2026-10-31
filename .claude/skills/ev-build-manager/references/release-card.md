# The release card

One card per release, when it is on staging, GREEN, and the end-to-end run worked:

1. **Version and commit** on staging, and that live waits on Matt's word ("ship <sha>" or his Ship it tap).
2. **What changed for him**, in plain words, by view.
3. **Side-by-side screenshots** of each changed view in desktop Chrome at 1280 (D-406; no phone shots, D-407).
4. **The rubric score** from the UI click-through (information only).
5. **What was retired**, including any check retired or rewritten for a superseded rule.
6. **The end-to-end run**: what ran, how long, what it cost.
7. **Known differences and risks**, and the code review's verdict with its backlog lines.
8. **What to try** when he tests.

## The rubric

Each factor 1 to 5 (5 matches or excellent, 4 small differences only a side-by-side shows, 3 noticeable but fine to
use, 2 gets in the way, 1 broken); points are score / 5 x weight.

| Factor | Weight | A 5 looks like |
| --- | --- | --- |
| Every demo screen is there, nothing extra | 20 | Every screen and control the demo has, and nothing it doesn't |
| Works on real data | 20 | No empty, broken or overflowing screens with long titles, exams with no objectives, busy days |
| Layout and spacing | 15 | Panes, alignment and rhythm read as the demo in desktop Chrome at 1280 |
| Type and hierarchy | 10 | Sizes and weights put the right thing first, as the demo does |
| Words | 10 | Labels and E.V.'s lines say what the demo says, or the same in fewer words |
| Feel | 15 | Clicks respond at once, states are clear, controls are comfortable with mouse and keyboard |
| Linear-level polish | 10 | Calm, dense, consistent, nothing looks unfinished |

A release is ready for Matt's word when, at one commit on main, npm test and smoke are GREEN, ship staging is GREEN
and the end-to-end run worked. A red nightly is filed as a bug and never blocks a release Matt has tested.
