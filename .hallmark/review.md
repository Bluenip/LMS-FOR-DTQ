# Hallmark review — 2026-11-02

Scope: working app screens. Source: 34 supplied Stitch exports; 8 canonical screens. Locked system: `stitch_custom_video_learning_platform/thi_t_k_chung/DESIGN.md`. No theme draw, marketing hero or stock photography applies to this app scope.

Material is the supplied Vietnamese content and explicitly marked demonstration records. No unprovided testimonial, customer count, proof metric or photograph was introduced. Class membership/progress/grades are computed from actual stored app data. Actual lecture videos are absent; their empty state explains that. The neutral upload poster is 1280×720 and does not claim to be a video frame.

## Verification

- Production build: passed.
- Backend: 13 tests passed, including browser-origin regression.
- Playwright: 3 tests passed against production server; student and teacher journeys plus all 8 screens at 1440px and 390px. No horizontal overflow.
- PostgreSQL: migration and seed executed against PostgreSQL 18.6.
- Object storage: 36 integration HTTP assertions passed with an S3-compatible local server, including actual bytes, signed upload/download and verified-video overwrite prevention. AWS/R2 accounts were not exercised.
- Prettier: passed.
- npm audit: zero vulnerabilities.
- Hallmark static: 0 FAIL, 0 open REFLEX, 1 WARN across 16 files.
- Hallmark rendered `/classes`, authenticated production: 0 FAIL, 0 open REFLEX, 1 WAIVED, 1 WARN. Captures include 1280×800, 1440×900, 1920×1080 folds and desktop/phone full pages.

## Judged findings

Gate23 waiver: the supplied design explicitly requires the terracotta class banners and login panel. About9.2% accent footprint on the classroom screen is deliberate; the stamp declares committed posture.

F4 warning dismissed after inspection: `.button.primary` is the sole primary action recipe. Secondary has a neutral white surface and border, ghost uses quiet paper, and danger is reserved for confirmed destructive actions. They are not competing primary actions.

## Fresh-context finish review

Independent subagent reviewed all16 full desktop/phone captures. Six findings were fixed:

1. Gradebook cells became labeled mobile rows with visible grading/reminder actions.
2. Five grading statistics use five desktop tracks; final mobile statistic spans both tracks.
3. Teacher lesson class selector matches42px field controls.
4. Capacity progress uses tokenized terracotta/paper browser pseudoelements.
5. Development badge disabled.
6. Duplicated teacher byline removed.

Teacher recaptures reviewed by the agent: resolved. Root inspected the corrected mobile gradebook and final production captures. No open Floor or Reflex finding remains. Screenshots live in `screens/` and `shots/`.

Real material that would improve readiness: licensed lecture video URLs/files and the operator's PostgreSQL/S3/R2 environment configuration. These are content/infrastructure inputs, not simulated by the application.
