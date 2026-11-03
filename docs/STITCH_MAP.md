# Stitch export map

The source directory `stitch_custom_video_learning_platform/` contains **34 HTML exports** and one shared design document. The exports represent **eight application screens** with iterations, duplicate prototypes, and alternate states. They should share application components and data rather than become 34 independent pages.

Routes below use `[id]`, `[lessonId]`, and `[assignmentId]` as identifiers. Class-detail tabs are represented by `?tab=overview|lessons|assignments|members|info`; lesson tabs use `?tab=materials|notes|discussion`. Search, status filters, and pagination should also be reflected in query parameters.

## Export-to-route coverage

Every directory listed below is relative to `stitch_custom_video_learning_platform/` and contains `code.html`.

| Export directory | Canonical application route | Screen and features | Source relationship |
| --- | --- | --- | --- |
| `01_l_p_h_c_c_a_t_i` | `/classes` | Student classes; active, pending, archived; class-code enrollment preview and request | Preferred student class-list source |
| `02_chi_ti_t_l_p_h_c_1` | `/classes/[id]` | Class overview, announcement, continue learning, lessons, assignments, members, course information | Earlier class-detail iteration |
| `02_chi_ti_t_l_p_h_c_2` | `/classes/[id]` | Same five class tabs, progress, deadline and rubric, honest absent-document state | Preferred class-detail source |
| `03_h_c_b_i_1` | `/classes/[id]/lessons/[lessonId]` | Video lesson, bookmarks, notes, discussion, assignment shortcut, curriculum | Richest interaction reference |
| `03_h_c_b_i_2` | `/classes/[id]/lessons/[lessonId]` | Same lesson workspace with missing-video and missing-material states | Preferred reference for unpublished/missing source |
| `04_n_p_b_i_t_p_1` | `/classes/[id]/assignments/[assignmentId]` | Written/file submission, draft, word count, attachment validation, pledge | Earlier submission iteration |
| `04_n_p_b_i_t_p_2` | `/classes/[id]/assignments/[assignmentId]` | Submission workspace plus explicit final confirmation and locked submitted state | Preferred submission source |
| `05_th_nh_vi_n_l_p_1` | `/classes/[id]/members` | Teaching profiles, student table, group filter, search, pagination | Earlier member-directory iteration |
| `05_th_nh_vi_n_l_p_2` | `/classes/[id]/members` | Accent-insensitive search, four study groups, filter reset and empty state | Preferred member-directory source |
| `06_qu_n_l_l_p_1` | `/teacher/classes` | Teacher classes, settings drawer, create/delete, members and approvals | Early management iteration |
| `06_qu_n_l_l_p_2` | `/teacher/classes` | Search/status tabs, capacity validation, settings and enrollment management | Management iteration |
| `06_qu_n_l_l_p_3` | `/teacher/classes` | Same teacher-class workflow and dialogs | Management iteration |
| `06_qu_n_l_l_p_4` | `/teacher/classes` | Same workflow, student preview, class create/settings/approval | Management iteration |
| `06_qu_n_l_l_p_ho_n_thi_n` | `/teacher/classes` | Complete teacher class-list, settings, code rotation, member review, archive/delete | Preferred management source |
| `06_qu_n_l_l_p_r_so_t` | `/teacher/classes` | Audited management iteration with same forms and member review | Alternate management source |
| `07_kho_b_i_gi_ng_1` | `/teacher/lessons` | Lesson library and editor, YouTube/upload sources, timestamps, draft/publish/delete | Earlier editor iteration |
| `07_kho_b_i_gi_ng_2` | `/teacher/lessons` | Chapter library, accent-insensitive search, status filters, material/assignment controls | Preferred lesson-library source |
| `08_ch_m_b_i_1` | `/teacher/assignments` | Gradebook, student filter, rubric, feedback, grade draft/return, assignment creation | Earlier grading iteration |
| `08_ch_m_b_i_2` | `/teacher/assignments` | Validated rubric, live counts, confirmation, unsaved-change guard, export | Preferred gradebook source |
| `09_xem_th_to_n_b_1` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |
| `09_xem_th_to_n_b_2` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |
| `h_c_vi_n_n_p_b_i_t_p` | `/classes/[id]/assignments/[assignmentId]` | Initial student submission design | Superseded by `04_n_p_b_i_t_p_2` |
| `l_p_h_c_b_i_gi_ng_tr_c_tuy_n` | `/classes/[id]` | Initial classroom detail and tabs | Superseded by `02_chi_ti_t_l_p_h_c_2` |
| `l_p_h_c_c_a_t_i` | `/classes` | Initial class-list and enrollment dialog | Earlier class-list source |
| `online_di_zi_gui_academy_platform` | `/classes/[id]` | Combined classroom prototype: upcoming work, progress, core materials, posts, join/video/submit overlays | Features distributed across class, lesson, and submission screens |
| `ph_ng_h_c_video_youtube` | `/classes/[id]/lessons/[lessonId]` | Initial lesson room with video, personal notes and discussion | Alternate interaction reference |
| `so_n_th_o_qu_n_l_b_i_gi_ng` | `/teacher/lessons` | Initial chapter library and lecture-editing layout | Superseded by `07_kho_b_i_gi_ng_2` |
| `so_n_th_o_qu_n_l_b_i_gi_ng_h_tr_video_youtube_t_i_l_n` | `/teacher/lessons` | YouTube/upload selection, timestamp editor, publishing and deletion | Alternate editor reference |
| `th_nh_vi_n_l_p_h_c` | `/classes/[id]/members` | Initial member-directory design | Superseded by `05_th_nh_vi_n_l_p_2` |
| `untitled_prototype_1` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |
| `untitled_prototype_2` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |
| `untitled_prototype_4` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |
| `untitled_prototype_5` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |
| `untitled_prototype_6` | `/classes` | Student class-list and enrollment dialog | Byte-identical to `01_l_p_h_c_c_a_t_i` |

## Shared design source

`thi_t_k_chung/DESIGN.md` defines the visual system. It is design data, not an additional application screen:

- Parchment canvas, warm ivory surfaces and borders, rust primary actions, amber highlights, jade completion states.
- `Newsreader` for headings and scriptural excerpts; `Be Vietnam Pro` for body copy, forms, navigation and tables.
- Responsive 12-column desktop grid, tablet adaptation, stacked mobile layouts.
- Base 8px radius, restrained warm shadows, compact academic controls.

The reference exports contain prototype-only labels and simulated success messages. Production behavior must use persisted application data and reflect actual errors and outcomes. Demonstration data must remain clearly identified as such.

## Functional requirements by screen

### Student classes

Search class name/code; switch active, pending and archived views. Preview a submitted class code before requesting enrollment. Handle existing membership, new request, existing pending request, unknown code, closed enrollment and full capacity. Allow cancellation of a pending request. Active classes open the class workspace.

### Class workspace

Show announcements, current lesson, real completion progress, assigned work and absolute deadlines. Provide lesson, assignment, member and information tabs. Respect publication/access conditions and show useful empty states when no lesson video or document exists. Continue-learning points to the appropriate available lesson.

### Lesson workspace

Support YouTube and stored video sources, with an explicit missing-source state. Include materials, personal notes, discussion, bookmark, completion, previous/next navigation and linked assignments. Completion should update persisted progress and affect sequential access. Notes are private to their author; class discussions require membership.

### Assignment submission

Require **300–500 words or a valid attachment**. Allowed assignment files are PDF, DOCX, JPG and PNG up to **25MB**. An evidence URL is optional; it does not replace required content. Require an honesty pledge before final submission. Support drafts, confirmation, submitted/read-only state, maximum two attempts, and returned grade/feedback. Deadline and resubmission policies come from the assignment.

### Members

Separate the class teacher from the source lecturer. Provide accent-insensitive student-name search, study-group filter, pagination, reset filters and a no-results state. Membership and personal information visibility follow the viewer's authorization.

### Teacher class management

Create classes and edit title, description, capacity, schedule and cover. Capacity is **1–500** and cannot be lower than current accepted membership. Copy or regenerate a class code. Toggle enrollment and automatic approval. Approve/reject requests without exceeding capacity. Archive completed classes; require the exact class code to confirm deletion.

### Teacher lesson library

Select class, search lessons and filter published/draft status. Edit title, order, chapter, description, timestamps, attached materials and associated assignment. Accept a valid **YouTube source or MP4/WebM upload up to 2GB**. Save drafts independently; require a usable source before publishing. Preview and delete with confirmation. Large files upload directly to object storage rather than through the application server.

### Teacher gradebook

Select an assignment; filter all, awaiting grading, graded and missing submissions; search students and paginate. Inspect written work and attachments. Score **understanding /40**, **practical examples /40**, and **presentation /20** with bounds enforced. Save grade drafts, confirm return to the student, and guard unsaved edits when changing students. Export grades, create assignments with absolute deadlines and late/resubmission policies, and provide reminders only through a configured delivery mechanism.

## Shared data and state

The reference class is `DTQ-2026`, with teacher Tuệ Tâm, lecturer Thầy Thái Lễ Húc and learner Nguyễn Văn An. Its shown progress is 11/40 lessons, with lesson 12 current and the week 4 assignment due **08/11/2026 at 23:59 GMT+7**. The exports label these as demonstration data; they are seed material, not verified activity.

Class, enrollment, lesson, progress, assignment, submission, feedback, discussion, attachment and note records should be shared by all routes. Interface counts must derive from these records rather than copied prototype totals. A backend must enforce role, ownership and membership checks on every mutation and protected read.
