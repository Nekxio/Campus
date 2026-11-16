# Application operations and remote MCP coverage

The remote OAuth MCP is served at `/mcp` and can be connected as `campus-app`. It exposes up to
**38 tools**, filtered by the connection's granted permissions. One tool can cover several HTTP
endpoints and form actions through the same domain service.

The local stdio MCP remains a folder-bound import/proposal adapter using API-key permissions.
Remote OAuth permissions do not widen local agent keys.

## Capabilities

| Area                  | Remote capabilities                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Home and lists        | Teaching home, class workspace, module list and import context                                                           |
| Classes and students  | Create/read/rename classes, append/rename/delete selected students, attach/recover/independently copy modules            |
| Module content        | Create, update and patch drafts, resources, lessons, exercises and rubrics, with explicit removals                       |
| Grading and proposals | Selected correction context, private proposals, complete grid, saved corrections/comments, proposal review and decisions |
| Final PDF exports     | Validated class and individual document data; rendering stays in the browser                                             |
| Publication           | Private review, explicit publish/unpublish, public class/module reads and quiz summaries                                 |
| Annual lifecycle      | Review, history, archive, reopen and confirmed purge with module continuation choices                                    |
| Teaching calendar     | Settings, preview, connect, sync and disconnect                                                                          |
| Native quizzes        | Read/create/patch drafts and explicitly save reviewed content; room control remains manual                               |

Account operations are excluded: profile, activation/invitations, login/logout, passkeys, sessions, OAuth consent and application revocation. Static legal/error pages do not manipulate teaching records. Browser selection preferences and PDF rendering/download remain local UI behavior.

Quiz rooms are intentionally excluded from MCP: listing, reading, opening, retakes and lifecycle commands remain under manual teacher control in the interface. Student quiz joining, credentials, answers and submissions remain the participant protocol. Quiz draft preparation and public quiz summaries remain available through MCP. MCP transport and OAuth discovery are protocol infrastructure rather than teaching CRUD tools.

There is no independent class, module or quiz DELETE operation in the application. Existing explicit module-part removals, student deletion and annual purge are covered; no new product deletion operation is invented.

## Authorization and recovery

- Existing OAuth grants do not acquire mutation powers automatically. Sensitive scopes require explicit consent; advertising or installing a tool does not grant its permissions.
- OAuth discovery advertises every supported scope so clients can select the permissions they need. Dynamic client registration still defaults to `modules:read`; advertising a scope never grants it.
- `roster:update` permits renaming/attachment; `roster:delete` separately permits deletion with current student/class revisions and `confirm=true`.
- `grades:read` permits full grids, comments, proposal review and final export projections. `grades:write` permits saved corrections/comments and proposal decisions.
- `publications:write` is separate from all draft scopes. Imports still never publish automatically. Explicit publication decisions reuse the review's revisions, confirmation and request receipt.
- `annual:read`, `annual:write` and the additional `annual:purge` separate review, archive/reopen and irreversible cleanup. Purge keeps the existing reviewed token, exact typed year, retained-PDF confirmation and explicit continue/pause decisions. Never invent those confirmations.
- `calendar:read` and `calendar:write` use the teacher-bound app workflow. The stored private feed URL is never returned.
- `quizzes:review` permits saving a reviewed quiz. Ordinary draft imports keep their review marker. There is no room-control scope or room command in MCP. Annual purge still cleans up associated private room data through the existing confirmed annual lifecycle.
- Receipt-backed operations retain stable retry identities. Non-receipted writes advertise `idempotentHint=false`: reread after a conflict or lost response rather than blindly repeating a copy, rename or delete.

Granted rights can be revoked through the connected-applications UI. Connecting a client does not
migrate or rewrite teaching records. Deployment rollback and migration decisions remain operator
procedures; they do not replace per-operation authorization.

## Verification limits

Integration tests use real OAuth and MCP calls against isolated migrated SQLite databases. Tests verify that room tools and room-control scopes are absent, including direct tool calls, while quiz preparation remains available. Existing application tests cover manual room lifecycle operations; they do not establish production Durable Object/network behavior. PDF tools return validated document data rather than PDF bytes. Production smoke checks must not publish modules, delete students or open rooms merely to verify installation.

## Complete HTTP endpoint inventory

| Methods                    | Route                                                                                | MCP equivalent / disposition                           |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| GET                        | `/.well-known/oauth-authorization-server/api/auth`                                   | MCP/OAuth protocol infrastructure                      |
| GET                        | `/.well-known/oauth-protected-resource/mcp`                                          | MCP/OAuth protocol infrastructure                      |
| POST                       | `/api/activation`                                                                    | Account excluded                                       |
| POST                       | `/api/agent/classes`                                                                 | create_class                                           |
| GET                        | `/api/agent/context`                                                                 | get_import_context                                     |
| GET                        | `/api/agent/correction-context`                                                      | get_correction_context                                 |
| POST                       | `/api/agent/modules`                                                                 | create_module_draft                                    |
| PATCH                      | `/api/agent/modules/[moduleId]`                                                      | patch_module_draft / update_module_draft               |
| POST                       | `/api/agent/proposals`                                                               | propose_correction                                     |
| POST                       | `/api/agent/quizzes`                                                                 | create_quiz_draft                                      |
| PATCH                      | `/api/agent/quizzes/[quizId]`                                                        | patch_quiz_draft                                       |
| GET                        | `/api/agent/quizzes/context`                                                         | get_quiz_context                                       |
| GET, POST                  | `/api/agent/roster`                                                                  | get_class_roster / add_class_students                  |
| GET, POST                  | `/api/auth/[...all]`                                                                 | Account excluded                                       |
| POST                       | `/api/enseignant/compte`                                                             | Account excluded                                       |
| POST                       | `/api/mcp/applications/revoke`                                                       | Account excluded                                       |
| POST                       | `/api/mcp/consent`                                                                   | Account excluded                                       |
| GET                        | `/api/quizzes/[contextId]`                                                           | list_public_quizzes                                    |
| GET, POST                  | `/api/quizzes/[contextId]/rooms/[runId]`                                             | Participant protocol; quiz rooms excluded from MCP     |
| GET                        | `/api/session`                                                                       | Account excluded                                       |
| POST                       | `/api/teaching/calendar`                                                             | calendar_command                                       |
| POST                       | `/api/teaching/classes`                                                              | create_class                                           |
| PATCH                      | `/api/teaching/classes/[classId]`                                                    | update_class                                           |
| POST                       | `/api/teaching/classes/[classId]/modules`                                            | attach_module                                          |
| POST                       | `/api/teaching/classes/[classId]/students`                                           | add_class_students (durable parsed identities)         |
| DELETE, PATCH              | `/api/teaching/classes/[classId]/students/[studentId]`                               | update_student / delete_student                        |
| GET                        | `/api/teaching/contexts/[contextId]/export`                                          | get_class_grade_export                                 |
| PATCH                      | `/api/teaching/contexts/[contextId]/students/[studentId]/assessments/[assessmentId]` | save_correction                                        |
| PATCH                      | `/api/teaching/contexts/[contextId]/students/[studentId]/comment`                    | save_semester_comment                                  |
| GET                        | `/api/teaching/contexts/[contextId]/students/[studentId]/export`                     | get_student_grade_export                               |
| POST                       | `/api/teaching/modules`                                                              | create_module_draft                                    |
| GET, PATCH                 | `/api/teaching/modules/[moduleId]`                                                   | get_import_context / patch_module_draft                |
| GET, POST                  | `/api/teaching/modules/[moduleId]/publication`                                       | get_publication_review / decide_publication            |
| PATCH                      | `/api/teaching/modules/[moduleId]/rubric`                                            | patch_module_draft with rubric                         |
| POST                       | `/api/teaching/proposals/[proposalId]/decision`                                      | decide_correction_proposal                             |
| GET, POST                  | `/api/teaching/quiz-rooms/[runId]`                                                   | Manual teacher control; excluded from MCP              |
| GET                        | `/api/teaching/quiz-rooms/[runId]/candidates`                                        | Manual teacher control; excluded from MCP              |
| GET, POST                  | `/api/teaching/quizzes`                                                              | get_quiz_context / create_quiz_draft / save_quiz_draft |
| GET, PATCH                 | `/api/teaching/quizzes/[quizId]`                                                     | get_quiz_context / patch_quiz_draft / save_quiz_draft  |
| POST                       | `/api/teaching/quizzes/[quizId]/rooms`                                               | Manual teacher control; excluded from MCP              |
| POST                       | `/api/teaching/years/[academicYear]`                                                 | decide_annual_year                                     |
| GET                        | `/api/teaching/years/[academicYear]/contexts/[contextId]`                            | get_annual_history                                     |
| DELETE, GET, OPTIONS, POST | `/mcp`                                                                               | MCP/OAuth protocol infrastructure                      |

**55 method handlers across 43 route files.** The Better Auth GET/POST catch-all owns additional authentication subroutes; these are excluded account operations.

Totals: **20 GET, 23 POST, 9 PATCH, 2 DELETE and 1 OPTIONS**; no PUT or HEAD handler is explicitly exported. Page loads and named form actions are counted separately below.

## Page reads (GET / load)

| Page                                           | MCP equivalent / disposition                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `/`                                            | get_teacher_home (account identity omitted)                          |
| `/activation`                                  | Account excluded                                                     |
| `/autoriser`                                   | Account excluded                                                     |
| `/classes/[classId]`                           | get_public_class                                                     |
| `/connexion`                                   | Account excluded                                                     |
| `/connexion/application`                       | Account excluded                                                     |
| `/enseignant/applications`                     | Account excluded; calendar: get_calendar_settings                    |
| `/enseignant/classes`                          | get_classes / get_class_roster                                       |
| `/enseignant/classes/annees`                   | get_annual_data                                                      |
| `/enseignant/compte`                           | Account excluded                                                     |
| `/enseignant/modules`                          | list_modules                                                         |
| `/enseignant/modules/[moduleId]`               | get_import_context                                                   |
| `/enseignant/modules/[moduleId]/bareme`        | get_import_context (includes rubric)                                 |
| `/enseignant/modules/[moduleId]/publication`   | get_publication_review                                               |
| `/enseignant/modules/[moduleId]/quiz`          | get_quiz_context; rooms controlled manually                          |
| `/enseignant/modules/nouveau`                  | get_import_context / get_classes                                     |
| `/enseignant/notation`                         | get_grade_grid (explicit IDs; browser selection preferences omitted) |
| `/enseignant/notation/[contextId]/[studentId]` | get_correction_context / get_grade_grid                              |
| `/enseignant/propositions`                     | get_proposal_review                                                  |
| `/enseignant/quiz/[runId]`                     | Manual teacher control; excluded from MCP                            |
| `/enseignant` layout                           | Account identity excluded                                            |
| `/enseignant/vue-etudiante`                    | list_published_classes / list_modules / get_public_module            |
| `/modules/[contextId]`                         | get_public_module                                                    |
| `/modules/[contextId]/quiz/[runId]`            | Participant transport; quiz rooms excluded from MCP                  |

## Named form actions (POST)

| Page                                           | Action              | MCP equivalent / disposition              |
| ---------------------------------------------- | ------------------- | ----------------------------------------- |
| `/autoriser`                                   | `decideConsent`     | Account-excluded                          |
| `/enseignant/applications`                     | `revokeApplication` | Account-excluded                          |
| `/enseignant/applications`                     | `calendarCommand`   | calendar_command                          |
| `/enseignant/classes`                          | `createClass`       | create_class                              |
| `/enseignant/classes`                          | `updateClass`       | update_class                              |
| `/enseignant/classes`                          | `addStudent`        | add_class_students                        |
| `/enseignant/classes`                          | `importStudents`    | add_class_students                        |
| `/enseignant/classes`                          | `updateStudent`     | update_student                            |
| `/enseignant/classes`                          | `removeStudent`     | delete_student                            |
| `/enseignant/classes`                          | `attachModule`      | attach_module                             |
| `/enseignant/classes/annees`                   | `decideYear`        | decide_annual_year                        |
| `/enseignant/compte`                           | `updateProfile`     | Account-excluded                          |
| `/enseignant/modules/[moduleId]`               | `saveModule`        | patch_module_draft                        |
| `/enseignant/modules/[moduleId]/bareme`        | `saveRubric`        | patch_module_draft                        |
| `/enseignant/modules/[moduleId]/publication`   | `decidePublication` | decide_publication                        |
| `/enseignant/modules/[moduleId]/quiz`          | `saveQuiz`          | save_quiz_draft                           |
| `/enseignant/modules/[moduleId]/quiz`          | `openRoom`          | Manual teacher control; excluded from MCP |
| `/enseignant/modules/nouveau`                  | `createModule`      | create_module_draft                       |
| `/enseignant/notation/[contextId]/[studentId]` | `saveAssessment`    | save_correction                           |
| `/enseignant/notation/[contextId]/[studentId]` | `saveComment`       | save_semester_comment                     |
| `/enseignant/propositions`                     | `decideProposal`    | decide_correction_proposal                |
| `/enseignant/quiz/[runId]`                     | `createRetake`      | Manual teacher control; excluded from MCP |

## Tool names

- `get_import_context`
- `create_module_draft`
- `update_module_draft`
- `patch_module_draft`
- `get_correction_context`
- `propose_correction`
- `get_quiz_context`
- `create_quiz_draft`
- `patch_quiz_draft`
- `get_class_roster`
- `create_class`
- `add_class_students`

- `get_teacher_home`
- `get_classes`
- `list_modules`
- `update_class`
- `update_student`
- `delete_student`
- `attach_module`
- `get_grade_grid`
- `save_correction`
- `save_semester_comment`
- `get_proposal_review`
- `decide_correction_proposal`
- `get_class_grade_export`
- `get_student_grade_export`
- `get_publication_review`
- `decide_publication`
- `list_published_classes`
- `get_public_class`
- `get_public_module`
- `list_public_quizzes`
- `get_annual_data`
- `get_annual_history`
- `decide_annual_year`
- `get_calendar_settings`
- `calendar_command`
- `save_quiz_draft`
