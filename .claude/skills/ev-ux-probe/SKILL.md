---
name: ev-ux-probe
description: Run E.V.'s UX probe (D-369) - cold testers walk the staging app in desktop Chrome at 1280 (D-406) and a synthesis agent writes the UX map doc. Use it to brief a full probe or, after any change Matt will see in a view, a delta probe of only the journeys that change touched.
---

# E.V. UX probe and delta probe (D-369)

This skill is for the **build manager** (to brief and run a probe) and the **synthesis agent**. Testers never see it:
they get only `tester-brief.md` (and `motion.md`), filled in and pasted or pointed to, because a tester who has read how
E.V. is built is no longer cold.

The probe's output is the **UX map**, a Claude Doc outside the repository:
https://claude.ai/artifact/Ts4o6bG8FjQF3Dkyr8Rx37 ("E.V. UX map: baseline probe", Oct 29). Its coverage ledger says
which journeys walk which views and components, at which build.

## Full probe or delta probe

- **Delta probe (the usual case).** After a change Matt will see in a view (a feature such as flashcards, a polish
  wave, a flow fix), re-walk only the journeys whose views or components the change touched. Testers append rows marked
  with the new build; the synthesis agent updates the ledger and only the rubric rows those journeys bear on. Never
  re-run everything.
- **Full probe.** Only for a new baseline: a change that reshapes most views at once, or Matt asks for one. Every
  journey, J0 to J7 and any added since.

To pick a delta's journeys: list what the change touched since the ledger's last probed build
(`git diff --stat <build>..<head> -- page/ pwa/`), name the views and components (page/app/<tab> files,
page/ds/components, and page/ds/views once view CSS moves there, D-388), and take every journey whose ledger row names one of them. A new feature gets a new
journey (J8 and on) written into the filled tester brief in the same shape as the others.

## Who takes part

| Who | What | Gets |
| --- | --- | --- |
| Tester A | laptop, 1280x800, one course | the filled tester brief + motion.md |
| Tester B | full probe only: phone, `isMobile`/`hasTouch`, the other course; a "loads and ticks" pass (D-407: it loads, a tick works, nothing overflows), no polish findings | the filled tester brief |
| Synthesis agent | turns findings into the UX map | `synthesis.md` + the tester folders |
| Matt | his own pass: agree, disagree or a note per signal, in the doc | a short plain line with the doc link |
| Build manager | budget line, briefing, filing the Tasks to add | this skill |

Testers and the synthesis agent are fresh agents that have not seen the work or an earlier probe. A delta probe uses
Tester A only.

## Budget line to Matt (ev-build-manager, Budget per release)

Before starting, one line saying why and what it costs, for example:

> UX probe (delta after <change>): 1 cold tester (desktop Chrome, 1280) re-walks J<n>, J<n> on staging's practice data, then
> 1 agent updates the UX map; about <45> minutes and two agents. They write plans, notes and quizzes on staging only.

A full probe is about 2 to 2.5 hours and three agents (testers in parallel, about an hour each plus 30 to 40 minutes of
motion; synthesis about 45 minutes).

## Steps (build manager)

1. **Sign-in file.** Save staging's `system/worker` document (one ArtifactData get with an `out_dir` in the sandbox
   scratchpad, e.g. `<scratchpad>/stg/system/worker.json`). It holds the staging Worker's `url` and `token`, under
   `.data` or at the top level. It stays in the scratchpad: never copy it, its token or a URL carrying it into the
   repository, a brief's text or a report.
2. **Tester folders.** One per tester in the scratchpad. Into each, copy `tester-brief.md`, `motion.md` and
   `fonts/inter-route.cjs`, and fill the brief's `<...>` lines: folder, viewport, course, sign-in file path, journeys.
   On a full probe, give the two testers **different courses** (NUR 112, BIO 201).
3. **Gallery (delta, Proprietary).** If the change touched a Proprietary component (page/ds/components,
   page/app/01-ui-*), add to the brief's journeys line: "Open the app's /gallery, find <component>, look at each state
   at 1280; same row protocol, Where = Gallery › <component>."
4. **Start the testers** in parallel, in the background: "Read <folder>/tester-brief.md and <folder>/motion.md and
   follow them. Your final message is your report." Keep them alive (D-358).
5. **Synthesis.** A fresh agent: "Load the ev-ux-probe skill and follow synthesis.md in <full | delta> mode; tester
   folders: <A>[, <B>]; change: <...>; build: <sha>."
6. **Matt's pass.** One plain line with the doc link: what was probed and the top frictions.
7. **File.** After his pass (or at once for a delta's few rows, with a line to him), file the doc's Tasks to add:
   `node tools/chart.mjs plan --from <doc link> --apply`. A signal he disagreed with is dropped or reshaped before
   filing.

## Lessons from the baseline probe (Oct 29)

- **Real font from the first shot.** The sandbox blocks Google Fonts; both baseline testers took early shots in a
  fallback font. `fonts/inter-route.cjs` serves Inter; it installs `@fontsource/inter@5.1.0` into the OS temp folder
  on first use, or set `EV_INTER_DIR`.
- **Testers must not share a course.** They share one account: the conversation, Today and a running study session
  showed the other tester's activity. Different courses keep the plan and notes apart; the brief tells them to note
  the shared parts once and end their sessions.
- **Findings come back in the final message.** A subagent cannot hand back files: its findings.md stays in its folder
  and its final message is the report. Paths in that message must be absolute.
- **The staging token comes from the saved worker.json**, read in the tester's script and set in `localStorage`; it is
  never printed.
- **Testers stay cold.** A tester that reads the repository reasons from the code, not the screen; the brief forbids
  it and the build manager never pastes code context into it.
