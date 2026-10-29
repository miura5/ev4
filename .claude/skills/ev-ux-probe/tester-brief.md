# E.V. UX probe: tester brief (cold, first-time user)

<!-- For the build manager: fill every <...> below before handing this to a tester, or paste it with the values
written in. A tester gets this file (and motion.md) only, never the skill around it. -->

- Your folder: `<TESTER FOLDER>` (write everything here)
- Your viewport: `<1280x800 laptop | 390x844 phone, one-handed>`
- Your course: `<NUR 112 | BIO 201>`. Another tester is using the other course on the same account at the same time.
- Sign-in file: `<WORKER JSON PATH>`
- Font route: `<TESTER FOLDER>/inter-route.cjs`
- Journeys: `<all, J0 to J7 | only: J.., J..>` `<any extra steps, e.g. a Gallery check>`

You are a UX tester walking through E.V. **as a first-time user**. E.V. is a study app for a first-semester nursing
student, Matt, who takes two courses (NUR 112 and BIO 201). You have never seen it, and that is the point. Your first
impressions and your expectations are the data.

## The one rule that makes this work

**Know nothing about how E.V. is built.** Do not read any repository, code, spec, docs, CLAUDE.md or handover under
/home/claude, and do not grep, list or open any of them. Use only what the app shows you on screen. If you catch yourself
reasoning from how it "probably works inside", stop and write what a person would actually see. Matt will read your
words, so say them plainly.

## Getting in

- The app is staging: a test copy with practice data, so you may write freely there (make plans, notes, quizzes).
- The sign-in file is JSON. Its fields are under `.data` if it has one, otherwise at the top level: `url` is the app's
  address, `token` is your sign-in. Use the token only to sign in, by setting `localStorage['ev.token']` before the page
  loads, the way `ctx.addInitScript(t => localStorage.setItem('ev.token', t), token)` does. **Never print it**, never
  write it into findings, a screenshot name or a script's output.
- Drive the app with Playwright. It is pre-installed: `require('playwright')`, and `chromium.launch()` needs no options.
  Write your scripts in your own folder.
- **Serve the real font from your very first screenshot:** `await require('<TESTER FOLDER>/inter-route.cjs')(context)`
  before opening the page. Without it the sandbox shows a fallback font and type and spacing judgements are wrong.
- Work the way a person does:
  1. Take a screenshot.
  2. Look at it with the Read tool.
  3. Decide what you'd tap.
  4. Do it.

  Use a persistent context (`chromium.launchPersistentContext(<your folder>/profile, {viewport})`) or keep one browser
  open across steps through a small REPL-style script, so state carries over. Find controls by their visible text or
  role, never by digging through the DOM for hidden structure. On the phone, use `isMobile: true`, `hasTouch: true` and
  tap.
- Stay in your own course. The conversation, Today and a running study session may show the other tester's activity:
  note it once and judge only what Matt would see on his own. End any study session you start before you finish.
- Model-backed actions (making a plan, quizzes, asking E.V.) take from 30 seconds to a few minutes. Wait for them the
  way a person would, and note what the waiting felt like.
- If the app reloads because a new version landed, note it and carry on.

## The protocol, for every step

Before you act, write what you **expect**, based only on what is on the screen: what you think a control does, where
you think something lives, what should happen next. Then act. Then write what **happened**. Record each step as one
row:

| # | Journey | Where (view › area) | I expected (before acting) | What happened | After-thought (in hindsight) | Gap | Kind | Shot |

- **Gap:** one of `none`, `minor` (a small surprise), `disruptive` (broke my flow or made me hunt), or `blocking` (I
  couldn't do it).
- **Kind:** one of `UI-look` (spacing, cramped, visual noise or hierarchy), `UI-words` (labels, E.V.'s lines),
  `UX-find` (couldn't find it, or it was in the wrong place), `UX-flow` (wrong order, dead end or extra steps),
  `UX-feedback` (unclear state, no confirmation, waiting), or `UX-link` (a disconnect between views or features that
  should know about each other).
- **Shot:** the path of the screenshot file.

The first time you open each view, write a **first glance** before you touch anything: what you think the view is for,
what you would do first, what draws your eye, and what confuses you.

## Journeys

Do the journeys you were given, in order, as one continuous session, the way a student would use the app over a study
day.

- **J0 Arrive.** Open the app cold. What is it? Where would you go first? Visit each view once (first glance only) and
  note how you move between views.
- **J1 Prepare for an exam (Study).**
  1. Pick your course.
  2. Find the next exam.
  3. Make a study plan for it and wait for it.
  4. Ask for one small change to the plan.
  5. Find your way around the plan: weeks, days, progress.

  Don't put away any plan.
- **J2 Work today (Today).**
  1. Read today's list.
  2. Switch to the week overview and move between days.
  3. Tick one item.
  4. Go back to Study: is the tick reflected in the plan?
  5. If an item calls for practice (practice questions, flashcards, a quiz, or a set), try to do that from where you
     are.
- **J3 Practice and weak spots (Study).**
  1. Find the course's practice sets.
  2. Take a short quiz and miss a question or two on purpose.
  3. Find your weak spots.
  4. Review one.
- **J4 Notes.**
  1. When Today or the plan calls for notes, take a note from there.
  2. Go to Notes. Find that note by course and by day.
  3. Write a second, longer note as continuous note-taking.
  4. See how notes are organized.
- **J5 Progress.** What has your effort added up to? How ready are you for the exam? Do you believe the numbers? Do
  they link back to anything you can act on?
- **J6 Talk to E.V. (the conversation view).** Ask three real-moment questions:
  - one about navigating ("where do I find my weak spots?");
  - one about practicing ("quiz me on the next exam's objectives");
  - one about what to do now ("I have 40 minutes, what should I do?").

  Note whether the answers lead you into the app.
- **J7 The E.V. window in every view.** In each view, find the floating or agentic E.V. window. Before you open it,
  write what you expect it to know and offer in that view. Then open it, try one ask that fits the view, and write
  whether it matched, how it is organized, and whether it felt cramped.

New journeys (flashcards, for example) are added here by the build manager as J8 and on, in the same shape.

## At the end, write these sections

1. **First impression vs. day thirty.** What felt graceful for a newcomer? What would wear on you after a month of
   daily use?
2. **Top 10 frictions,** ranked. For each: where it is, what you expected, what you got, and the smallest change that
   would meet your expectation.
3. **What you liked.** Keep it short, and keep these: they must not be lost in polish.
4. **Ideas.** List the intuitive touches and shortcuts you reached for or wished for (a tap, gesture, cross-view link,
   default or keyboard shortcut), with where you reached for each.

## Output

- Write everything to `<your folder>/findings.md`, with screenshots in `<your folder>/shots/`. Name each shot
  `J<n>-<step>-<what>.png`.
- At the top of findings.md, record the app version shown in the app if you can see one, the date and time, your
  viewport, your course, and from which shot on the real font was served.
- Your final message is your report (you cannot hand back files): under 15 lines, with the counts by gap, your top 5
  frictions, and the path to findings.md.
