# Module publication and public course pages

Publication is a teacher-only decision for one reusable module and one exact class/year context.
The saved private draft and the public snapshot are separate. Editing a module, importing it through
MCP or replacing its rubric never publishes a course page automatically.

## Teacher workflow

1. Save the module, student links and class calendar. Save evaluation deadlines in its rubric.
2. Open **Publication** from the saved module and choose the class/year.
3. Review the five sections in the private preview. Changed sections are identified; the preview
   uses the same content renderer as the public page. Section links are navigation, not approval gates.
4. Choose **Publier pour cette classe** or **Publier la mise à jour**. The server reconstructs the
   reviewed projection from saved records; it does not accept a submitted public snapshot.
5. Open the published page or use **Copier un lien** beside it for the module/class links. The header
   refresh icon is **Actualiser les références**. **Dépublier** requires confirmation and
   takes the page out of the class directory; republication uses the same URL.

A newer saved draft stays private while the previous snapshot remains public. Publishing checks the
module, context, class and publication revisions in one transaction. HTTP 409 retains the reviewed
preview and blocks a decision until **Actualiser les références** deliberately loads current content.
Identical requests retain their UUID after a lost response. Transactional receipts prevent duplicate
publication and prevent an old publish/unpublish retry from reversing a later decision. Failed refresh
following a successful write requires an explicit refresh before another decision.

## Public projection and links

- `/modules/[contextId]` serves a validated version-2 snapshot, without a session or teacher navigation.
- `/classes/[classId]` lists only published modules in active contexts. Names and descriptions come
  from reviewed snapshots, never from an unpublished draft. A never-published class has a generic
  empty directory; its unpublished identity is withheld.
- The module’s five tab panels contain selected course links, instructions/rubric links, assessment
  deadlines with submission instructions, useful resources and optional public lesson recap/to-do.
  Its header also includes the saved title, description, objectives and class/year. Dates use Paris time.
  Document labels and named open/read actions are distinct; PDF badges require a URL ending in `.pdf`.
  The selected panel is identified by shadcn-svelte Tabs. Deadline and project links remain in a
  separate rail across tab selections; on narrow screens the rail follows the selected content.
  All five tabs stay discoverable, including a truthful empty recap/to-do state. All deadlines are
  retained in their panel; the rail identifies an upcoming deadline or labels the latest past deadline.
  Source objectives are available with the course supports. No explanatory course text is invented.
- Private preparation, local source paths, rosters, individual grades, corrections, submissions,
  semester comments, proposals, sessions and agent keys never enter the public DTO.
- Text renders as text; selected HTTPS links open externally with a no-referrer policy. The server
  does not fetch links. Optional empty lesson notes are omitted; required empty sections remain clear.
- Public responses, including errors, use `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
  Public-by-link access is not authentication; anyone with the link can read the published content.
  Already downloaded documents cannot be recalled by unpublishing.

An unpublished, missing, malformed or legacy version-1 snapshot fails closed, without falling back
to its draft. A teacher reviews and republishes legacy material before making it public. If an annual
class is removed, its directory disappears. Its durable context snapshot remains reachable at the
module URL without a class-return link, and the teacher can still unpublish it. Archived contexts
cannot be republished. This retention supports the approved future annual purge; that UI is separate.

## Drive remains external

Coursely stores selected Drive/external links only. Publishing a page does not change file sharing.
Replacing a file that is already shared changes what its existing link serves immediately, independently
of the Coursely publication button. No Drive SDK, credentials, upload or permission change is included.
The professional Drive anonymous-sharing and same-ID replacement check remains an operator step on
an explicitly selected fictional file before real classroom use.

## Migration and local checks

`drizzle/0005_nasty_skrulls.sql` adds source/context/class revisions and a teacher-bound publication
receipt table. It was generated offline and tested against fresh and legacy local databases; it has
not been applied to Turso. Preserve migrations `0000`–`0005` in order for a new dedicated installation.
Receipts store IDs, revisions and hashes only, never source bodies or student data. They are durable
with their context; annual student deletion does not remove a module publication.

`pnpm db:fixtures` now adds a separate fictional publication module. Its initial public snapshot and
newer private link differ, allowing explicit publication to be tested. Example `.test` document links
are placeholders, not real downloadable supports. Existing grading and proposal fixtures remain intact.
Browser QA uses an isolated loopback copy and a new fictional database. Local fixture connection and
session seams never enter application source. Production-source Workers checks run independently with
no secrets and keep private pages/API writes guarded. No cloud migration or deployment is part of this lot.
