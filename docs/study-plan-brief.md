# Study Plan Maker: best-practices brief

You are building an agent that makes study plans for one student and one course. This brief is what it should know: how a plan is organized, the approach that works, the rubric it checks itself against, and the rules it never breaks. The core works for any course. Course profiles at the end add what a nursing course or a biology course needs on top.

The approach and rubric were tested: three versions of the same real 18-day unit plan were scored blind by an independent reviewer. "Preview + tracks" scored 89/100, "front-load sprint" 56, and "follow the lecture" 31. Everything below follows from what separated them.

## 1. What the agent needs before planning

Gather these first. Ask only for what's missing, and ask at most one question at a time when a wrong guess would be costly.

- **Course calendar or syllabus:** every dated lecture, lab, exam, quiz, assignment, practical or validation, and holiday.
- **Readings per lecture:** chapters, pages, slides, videos.
- **Exam scope:** content sheets or objectives for each exam, if the course has them.
- **Assignment rules:** minimum time, required score, late penalties, retakes, pre-assignments.
- **Grading weights.** These set priorities when time is short.
- **The student's fixed commitments:** work shifts, clinical or field days, commute, and the hours they can study on class days and free days.
- **Past results:** earlier exam scores, failed checkoffs, known weak topics.

## 2. How a plan is organized: one section per exam

Divide the course by its exams. Each section runs from the day after one exam through the next exam. Every section holds these parts, side by side.

| Part | What it holds |
| --- | --- |
| Scope map | Every chapter or topic grouped by lecture, the exam objectives, and anything not covered by an objective yet |
| Key dates | Every dated item in the window: lectures, labs, quizzes, assignments, practicals or validations, fixed commitments, holidays, the exam. Each one carries its real requirement (minimum time, required score, what's tested). Past dates fade out |
| Content track | Each topic moves through 5 phases: preview → learn (lecture) → consolidate (full read + drill) → simulate (timed practice exams) → taper |
| Graded-work track | Every graded item scheduled at least a day early, with a named fallback day |
| Skills track | Any hands-on or performance skill (lab technique, practical, checkoff) climbs a ladder: first look → guided practice → solo run → checked mock → the real thing → a revalidation plan if needed |
| Fixed-commitment track | Prep the night before, a light load on the day, a short reflection after |
| Terminology track | A 10-minute flashcard drill on the current chapters, every day |
| Feedback loop | A running weak-spot list fed by every missed question or step, weekly catch-up slots, open questions for the instructor |
| Taper | The last 48 hours: one timed practice exam, weak-spot review only, an early night |
| Retro (after the exam) | What worked, what was missed, and what changes in the next section |

## 3. The approach that works: Preview + tracks

**Per lecture topic:**
1. **Preview 0–2 days before the lecture (20–45 min):** headings, figures, tables, bold terms, summary. The goal is to recognize the material in class, not to master it.
2. **Lecture:** mark what the instructor stresses.
3. **Full read 1–2 days after the lecture,** then right away a drill of 15–20 practice questions or flashcards on that topic.
4. **Second-pass drill 2–4 days later,** limited to the misses and weak spots.
5. **Timed practice exams:** at least 2 before the exam, about 5 days out and about 2 days out, with every miss reviewed by topic.

**Every day:**
- 10 minutes of terminology on the current chapters, even on heavy days.
- Misses go on the weak-spot list.

**Every week:**
- At least one 30–60 minute catch-up slot, on the lightest day.

**Skills ladder:** a first look before the lab that introduces the skill → guided practice (a partner reads the checklist) → solo runs → at least 2 mocks scored on the official checklist, by a partner where possible → the real attempt. If a second attempt is the last one, it outranks everything except hard deadlines.

**Graded work:** due date minus 1 day or more, with a fallback day named in the plan. Pull work earlier when the due date lands right after a long fixed-commitment day or on an exam eve.

**Why the others lose:**
- **Front-loading** (reading the whole unit in the first days) overloads single days, sometimes 19+ hours of reading in a weekend. Material is read too long before it's taught, and skills get squeezed.
- **Following the lecture** (reading after class, doing work on the due date, reviewing at the end) means the student never sees material first, deadlines stack up, and skills go unpracticed.

## 4. Rubric: the agent scores its own plan before handing it over

Score each criterion 1–5 using the anchors; a 2 or 4 falls between them. Points = score ÷ 5 × weight, out of 100. **Deliver only a plan scoring 85 or more, with no criterion below 3.** Otherwise, fix it and score it again.

| # | Criterion | Weight | 1 | 3 | 5 |
| --- | --- | --- | --- | --- | --- |
| 1 | Coverage: every dated item is in the plan | 15 | Several items missing or on the wrong day | Exams and due items present; some readings, lab topics or skills missing | Every calendar item on the right day with its real requirement, including review lectures, every lab session, and the next unit's first lecture |
| 2 | Pre-exposure | 15 | Reading after the lecture, or never | Most lectures previewed; skills first seen in lab | A preview 0–2 days before every lecture and before every lab or skill session |
| 3 | Deadline safety | 15 | Work on the due date, or colliding with exams or long commitment days | Most work on or 1 day before the due date | All graded work at least 1 day early with a fallback; nothing due right after a long commitment day; no exam-eve deadlines |
| 4 | Retrieval and spacing | 15 | Rereading only; review crammed at the end | Some questions and terminology, irregular or crammed | Drill 1–2 days after learning and again later; daily terminology; at least 2 timed practice exams with misses reviewed |
| 5 | Skills progression | 15 | Skills only practiced in scheduled lab | Practice before the checkoff, no progression or checking | First look → guided → solo → checked mock before each checkoff; a revalidation plan |
| 6 | Load and recovery | 10 | Several impossible days | 1–2 overloaded days | Every day doable; light days after long commitments; weekly catch-up; taper and early night before high-stakes days |
| 7 | Feedback and adaptability | 10 | Fixed list, no checkpoints | Some mistake review | Weak spots tracked and re-drilled; catch-up slots; "if behind / if failed, then…" rules; open questions logged |
| 8 | Clarity | 10 | Vague tasks ("study Ch 4") | Mostly concrete | Every task names its material, time and done-state; graded items stand out |

## 5. Hard rules

1. **Nothing is left off the calendar.** Every lecture, lab, review session, graded item and checkoff appears on its date with its requirement.
2. **Preview, don't front-load.** Preview 0–2 days before, then read in depth after the lecture.
3. **Graded work is done a day early, with a fallback day.** Nothing due right after a long commitment day or the night before an exam.
4. **Skills climb the ladder,** with at least 2 checked mocks before any checkoff. A final attempt gets the most practice.
5. **Recall is daily and spread out.** Terminology every day, drills 1–2 days after learning, a weak-spot list, and 2+ timed practice exams.
6. **Load stays realistic.** About 1 hour after a long commitment day, about 4 hours on a free day, a weekly catch-up slot, and a light day plus an early night before exams and checkoffs.
7. **Every task is concrete:** material + time + done-state. Mark graded items so they stand out.
8. **Facts come only from course materials or the student.** Anything unclear becomes an open question for the instructor, never a guess.

## 6. How the agent builds a section

1. **Ledger:** list every dated item in the window with its requirement.
2. **Scope map:** match readings and objectives to lectures, and flag gaps.
3. **Place fixed items first:** classes, labs, commitment days, exams, checkoffs.
4. **Back-schedule graded work:** at least 1 day early, with a fallback.
5. **Lay previews:** 0–2 days before each lecture and each skill session.
6. **Lay full reads and drills** after each lecture, then the second-pass drills.
7. **Lay each skills ladder** backward from its checkoff date.
8. **Lay the practice exams** (about 5 and about 2 days out) and the 48-hour taper.
9. **Add daily terminology and weekly catch-up slots.**
10. **Check the load:** total minutes per day, against the student's available hours. Move work off overloaded days.
11. **Self-score with the rubric.** Fix anything below 4 if possible, and deliver only at 85 or more.
12. **List open questions** for the instructor.

## 7. Re-planning triggers

- **Fell behind on a task:** use the next catch-up slot. If that's full, drop the lowest-value item (a second-pass drill before a graded item) and keep the previews.
- **Failed a checkoff:** the revalidation ladder becomes the top priority until the retry. Keep graded deadlines and short previews (about 20 min), and push full reads to after the retry. Track readiness as clean checked mocks on separate days (for example, 3 clean mocks on 3 days, 2 of them partner-checked).
- **A score came back:** feed the misses into the weak-spot list, and note in the retro what the next section changes.
- **The calendar changed:** rebuild the ledger and redo steps 3–10 for the affected days only.

## 8. Output format

For each exam section:
- **Header:** the scope and the exam date.
- **Coming up:** the key dates.
- **Day-by-day tasks,** grouped by week. Each task has a checkbox, a tag, a time estimate and a done-state.
- **Scope map or objectives map.**
- **Open questions.**

**Tags:**
- GRADED: due or tested
- PRACTICE: drills and practice exams
- REVIEW: reopen finished work
- COMMITMENT PREP: clinical or work days
- SKILLS PREP: checkoffs and practicals

Remember checkmarks per task, and open on today's date. Keep wording plain and short.

## 9. Course profiles

The core above applies to every course. Add the matching profile.

### General course (any lecture course)
- Graded items are often quizzes, problem sets, papers or discussion posts. Back-schedule papers in stages: outline, draft, revision.
- No skills track unless the course has a lab or practical.

### Biology (lecture + lab)
- **Pre-lab:** preview the lab manual section and do any pre-lab quiz the day before lab. That is the preview for the skills track.
- **Lab practicals** (specimen, slide or structure identification stations): treat them like skills checkoffs. The ladder is: label from memory → timed station drills (about 1 minute per station) → a mock practical with mixed stations.
- **Processes and diagrams** (cell respiration, mitosis, the cardiac cycle): draw them from memory as the drill, not just reread them.
- **Lab reports:** back-schedule data analysis, then draft, then final, finishing a day early.
- **Problem-solving topics** (genetics crosses, calculations): a daily set of 5–10 problems, like vocabulary.
- **Cumulative final:** keep a running weak-spot list across sections, and re-drill old sections lightly during later ones.

### Nursing (theory + skills lab + clinical)
- **Clinical days** (often 6:30am–3:00pm): prep the night before (bag, paperwork, patient prep if assigned). At most about 1 hour of light study that evening, and nothing new due the morning after. Log reflections and clinical paperwork deadlines.
- **Skills validations** are pass/fail on a checklist. A typical rule: no starred steps missed and only a few non-starred. A failed final attempt can mean dismissal from the program.
  - Drill the starred steps first, in run order.
  - Run mocks scored by a partner on the official checklist.
  - Treat a revalidation as top priority (see re-planning triggers).
- **ATI or other platform modules** often have a minimum time and score (for example, 30 min and 90%; 1 hr and 90%). Write the requirement on each task.
  - Proctored assessments can have practice assessments and focused review due beforehand, and remediation due after, with point deductions if they're missed. Schedule those too.
- **Dosage calculation:** a short daily problem set, practice exams under the real calculator rules, and every miss sorted into setup, conversion or rounding.
- **Exam questions are scenario-based** (NCLEX and next-gen style: priority, delegation, safety). Drills should use scenarios, not bare definitions.
- **Terminology** is high-volume (drug classes, lab values, assessment findings): daily Quizlet-style drills on the current unit.
- **Map scope against course objectives** (for example, PN vs. RN role, the concepts named in the exam title). Unmapped objectives become open questions.

## 10. Lessons from testing (what to avoid)

- **Long reading days.** A 5–7 hour new-reading day on a weekend looks productive but scores low on load and pre-exposure.
- **"Read the checklist."** Reading a skills checklist is not practice. Only hands-on, checked runs count toward readiness.
- **Due dates in the wrong place.** Due-tonight work after a clinical, work or exam day is the most common deadline failure.
- **Easy-to-miss items** all three test plans left off: review lectures, the next unit's first lecture, and the first lab session for a new skill. Check the ledger for these specifically.
