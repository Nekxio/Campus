# Coursely

Coursely organizes reusable teaching modules, their delivery to yearly classes and the
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
rubric/context/correction revisions. It does not change recorded results until the teacher accepts
the retained points. A proposed semester comment has its own independent decision.
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
The approved version of a Coursely course page and its links, visible to students. Sharing
and replacing the linked Drive files remain separate actions.
_Avoid_: Grade publication, Drive file sharing

**Annual purge**:
The explicitly confirmed close of a selected year, removing its student grading data in Coursely while retaining every module. Each module is continued with an empty new cohort or put aside privately.
_Avoid_: Module deletion, teacher account deletion

**Quiz section**:
A set of Wayground quiz scores. Each quiz has a question-count maximum and the same weight after normalization; quiz questions and execution stay outside Coursely.
_Avoid_: Question bank, raw-point aggregate across unequal quizzes

**Module put aside**:
Teaching content retained privately, with its previous public link disabled until an explicit resumption and publication.
_Avoid_: Deleted module

**Public class identity**:
The stable destination students use to find a class’s published modules across explicitly confirmed annual transitions. It does not identify or carry a student cohort’s grades.
_Avoid_: Annual roster, student account
