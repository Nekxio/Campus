# Campus

Campus organizes reusable teaching modules, their delivery to yearly classes and the
teacher's private grading. These terms reflect the business scope agreed during planning.

## Language

**Module**:
A durable body of teaching content, preparation, materials and assessment definitions belonging to one class. Another class receives an independent copy. Its teaching content survives annual student-data removal.
_Avoid_: Yearly class, grade grid

**Module draft**:
The private working content of a module, prepared manually or by an agent and reviewed before publication. Updating a draft does not replace the published student page.
_Avoid_: Published course, student results

**Class**:
A cohort of students for a particular academic year, sharing its membership across the
modules taught to that cohort.
_Avoid_: Module, academic level

**Teaching context**:
The delivery of a module to a class in an academic year, with its lesson schedule and
assessment deadlines.
_Avoid_: New module, copied grades

**Student**:
A person whose work is assessed within a class. In the first version, a student is not a
login account.
_Avoid_: User, account

**Assessment**:
A quiz, project, oral presentation or other assessed production with defined scoring rules.
A formative assessment does not contribute to a calculated grade.
_Avoid_: Result, criterion

**Rubric**:
The groups and individual scoring lines defining an assessment's maximum points and
expected work.
_Avoid_: Student scores, correction

**Correction**:
The student's recorded points on an assessment's scoring lines, with the assessment status
and applicable submission or lateness information.
_Avoid_: Rubric, general grade grid

**Correction proposal**:
Private agent-suggested scoring-line points for one student and assessment, anchored to current
rubric/context/correction revisions. It does not change recorded results until an explicit acceptance by the teacher or a remote OAuth
client with separately delegated grading rights. Local agent keys cannot decide proposals. A proposed semester comment has its own independent decision.
_Avoid_: Recorded correction, automatically accepted grade

**Retained points**:
The teacher's editable choice in proposal review, initially merging proposed lines with existing
points. Recorded points change only after explicit acceptance.
_Avoid_: Original proposed points, saved results

**Decision receipt**:
The IDs, states and revision returned for an idempotent teacher decision. It prevents retries from
reapplying scores over a newer manual correction and is purgeable with the proposal.
_Avoid_: Permanent copy of student scores or comments

**Result**:
A grade calculated from the approved assessment rules and recorded points. A module may
have multiple independent results instead of one combined grade.
_Avoid_: Raw points, automatic annual average

**Semester comment**:
A private teacher comment about one student's work in a module, prepared for review and
copying into the school's form.
_Avoid_: Criterion justification, public student feedback

**Module publication**:
The approved version of a Campus course page and its links, visible to students. Sharing
and replacing the linked Drive files remain separate actions.
_Avoid_: Grade publication, Drive file sharing

**Annual purge**:
The explicitly confirmed close of a selected year, removing its student grading data in Campus while retaining every module. Each module is continued with an empty new cohort or put aside privately.
_Avoid_: Module deletion, teacher account deletion

**Quiz section**:
A set of native or external quiz scores. Each whole quiz occupies one scoring line and has the same weight after normalization, regardless of its question-count maximum.
_Avoid_: Question bank, raw-point aggregate across unequal quizzes

**Quiz draft**:
The teacher's editable questions, correct options and duration for a graded quiz associated with a lesson and one quiz scoring line. Opening its first room freezes that content for the examination and its retakes.
_Avoid_: Published correction, quiz attempt

**Quiz room**:
One classroom sitting of a quiz, opened and started by the teacher and closed after students finish. Its expected cohort is fixed at the first start, including absentees.
_Avoid_: Lesson, student account

**Quiz attempt**:
One student's shuffled question order, saved answers and effective deadline in a room. Submission, expiry or teacher interruption locks its answers.
_Avoid_: Whole assessment, rubric line

**Quiz absence result**:
The default zero recorded for an expected student who did not take that quiz. Only this provenance permits an authorized retake to replace the zero automatically.
_Avoid_: Genuine scored zero, manually entered score, whole-assessment absence

**Quiz retake**:
A separate room using the frozen quiz for explicitly selected absentees. It can replace their untouched absence results without overwriting other students' marks. The same follow-up room may also include a first sitting for selected newcomers with no mark and no prior cohort for that quiz; those students are not taking a retake.
_Avoid_: Practice attempt, unrestricted retry

**Ephemeral quiz review**:
The final display of a student's score, selections and correct options after teacher closure. Leaving or reloading that screen ends application access to the correction.
_Avoid_: Course correction, permanent student history

**Module put aside**:
Teaching content retained privately, with its previous public link disabled until an explicit resumption and publication.
_Avoid_: Deleted module

**Public class identity**:
The stable destination students use to find a class’s published modules across explicitly confirmed annual transitions. It does not identify or carry a student cohort’s grades.
_Avoid_: Annual roster, student account
