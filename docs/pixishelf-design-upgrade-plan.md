# PixiShelf Design Upgrade Plan

## 1. Objective

Upgrade `packages/pixishelf` into a coherent, modern personal image archive while preserving its existing product behavior, routes, data access, scanning pipeline, and media-processing workflows.

The target visual language keeps PixiShelf's blue-and-white identity and borrows the stable content-first principles associated with Pixiv:

- artwork is the dominant visual material;
- page chrome is quiet, compact, and mostly neutral;
- blue is reserved for links, selection, focus, and primary actions;
- ordinary content sections are separated by spacing and rules instead of shadowed cards;
- bounded controls, forms, dialogs, and workbench surfaces may retain white panels;
- PixiShelf keeps its own logo, terminology, navigation model, and administration features.

## 2. Confirmed Product Decisions

- Product position: a private digital archive for a heavy image collector.
- Scope: phased full-site redesign without changing business logic.
- Dashboard: keep the existing sequence of recent artworks, popular artists, and recommended artworks.
- Terminology: standardize on `作品`, `沉浸浏览`, and `艺术家`.
- Desktop density: relaxed content pages, compact artwork grids, efficient admin workbenches.
- Mobile navigation: `首页`, `作品`, `沉浸浏览`, and `更多` in a bottom navigation bar.
- Mobile admin: support navigation, viewing, filtering, and light edits; desktop remains the primary surface for complex imports, ordering, and batch replacement.
- Accessibility scope: preserve correct native elements, labels, visible focus, dialog behavior, and practical keyboard access; do not add a bespoke screen-reader workflow.
- Selection and copying: user-facing text is selectable by default. `select-none` is limited to genuine controls and drag handles. IDs, paths, URLs, logs, and table values receive explicit copy affordances where useful.
- Media behavior: keep current Viewer gesture and media context-menu behavior unless a specific workflow requires a change.
- Theme: prioritize the blue-and-white light theme. Existing dark tokens remain available, but full dark-mode expansion is deferred.
- Typography: use a reliable system Chinese font stack and a system monospace stack for IDs, paths, and numeric utility data.
- shadcn strategy: keep Radix + New York, add missing official components through the CLI, and never apply a preset or overwrite modified components without an explicit diff review.

### Visual Direction Specification

The implementation direction is **PixiShelf Blue Archive**: a quiet blue-and-white image index, not a clone of Pixiv and not a generic collection of shadcn cards. Artwork supplies the color and visual weight; application chrome behaves like a thin catalog index around it.

#### Core palette

The application exposes these roles as semantic tokens rather than using the literal values in page classes:

- `Gallery White` `#FFFFFF`: the user-approved page background for gallery and workbench routes; subtle neutral fills are limited to bounded controls and secondary surfaces.
- `Paper Surface` `#FFFFFF`: controls, dialogs, forms, and bounded work surfaces.
- `Gallery Ink` `#1F2937`: primary text and high-emphasis utility data.
- `Quiet Slate` `#5F6B7A`: descriptions, counts, and secondary metadata.
- `PixiShelf Accent` `#0096FA`: the archive index marker, focus treatment, selection tint source, and other non-text brand accents.
- `Signal Red` `#C8323C`: destructive actions and genuine failure states only.

Interactive text and filled actions use a darker `Action Blue` `#006FBE`, not the brighter accent token. On Archive Canvas, `#006FBE` has approximately `4.87:1` contrast; white on `#006FBE` has approximately `5.23:1`. White on `Signal Red #C8323C` has approximately `5.28:1` contrast. The bright `#0096FA` accent is never used for ordinary small text or as a white-text button background. Token foreground/background pairs must maintain at least `4.5:1` for normal text and control labels.

Blue hover, muted surface, borders, success, and warning colors are derived semantic roles with documented contrast; they do not become decorative gradients or arbitrary per-module accents. Large blue fields, blurred color blobs, and tinted card mosaics are excluded.

#### Type, shape, and density

- Body font: `ui-sans-serif`, `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `"Noto Sans SC"`, `"Microsoft YaHei"`, sans-serif.
- Utility font: `ui-monospace`, `SFMono-Regular`, `Cascadia Code`, `Roboto Mono`, monospace for IDs, paths, timestamps, and numeric diagnostics.
- Type scale: display `32/40`, page title `24/32`, section title `18/28`, body `14/22`, utility `12/18`; mobile page title steps down to `22/30`.
- Corners: `10px` for controls and compact panels, `16px` for dialogs and major work surfaces; image corners may be `6px` or square when density requires it.
- Shadows: `surface` is a quiet one-pixel border with at most a shallow shadow; `floating` is reserved for menus, sheets, and dialogs. Ordinary content sections do not receive a white shadow card.
- Spacing follows `4, 8, 12, 16, 24, 32, 48`. Frontstage sections use `24–32px` rhythm; artwork gaps use `8–12px`; admin rows and control groups use `8–16px`.

#### Layout axes

- `gallery`: up to `1600px`, image-led and dense, with `16/24/32px` responsive gutters.
- `standard`: up to `1280px` for dashboard, artists, tags, series, and settings.
- `reading`: up to `720px` for descriptions and form-heavy detail content, paired with a wider media rail when needed.
- `workbench`: up to `1680px`, with a `240px` desktop sidebar and a fluid table/work area.
- Header, contextual toolbar, title, and content use the same container variant so their left and right axes do not jump between routes.

Desktop gallery:

```text
| compact global header ----------------------------------------------- |
| collection / count | search + filters + sort | immersive action ----- |
| [artwork][artwork][artwork][artwork][artwork]  image-led contact sheet |
| [artwork][artwork][artwork][artwork][artwork]                         |
```

Mobile gallery:

```text
| route title / compact context action |
| search + filter/sort sheet trigger   |
| [artwork] [artwork]                  |
| [artwork] [artwork]                  |
| Home | Works | Immersive | More      |  safe-area aware
```

Admin workbench:

```text
| 240px grouped, scrollable nav | breadcrumb + title + primary action |
|                               | filter rail                         |
|                               | compact table / bounded form        |
```

On mobile, the admin sidebar becomes a current-module header plus navigation Sheet; desktop-only batch work displays an explicit compact-screen limitation instead of a crushed two-column dialog.

The signature element is the **archive index rail**: one restrained horizontal toolbar that joins collection identity, result count, active filters, and the primary viewing action. Its thin blue active marker and monospaced counts recur across gallery and workbench shells. This supplies product identity without gradients, blobs, excessive cards, or ornamental dashboard graphics.

## 3. Baseline Findings

### Visual system

- Semantic shadcn tokens exist, but application pages frequently bypass them with raw blue, gray, slate, red, and hex values.
- Radius, shadow, spacing, and surface decisions vary by page.
- Login, gallery, settings, content warning, and admin screens do not yet read as one product.
- Artwork and dashboard content is over-carded in some areas while other surfaces are almost unstyled.

### Layout

- The primary information architecture is understandable.
- Header, toolbar, and content widths use unrelated `container`, `max-w-*`, and arbitrary-width values.
- Admin navigation disappears below `md` without a peer mobile navigation surface.
- Some complex dialogs and workbenches use fixed desktop dimensions that cannot reflow safely.

### Interaction

- Desktop mouse flows are generally usable.
- Several navigation and media actions use clickable `div` or `span` elements.
- Form labels, error relationships, dialog focus, icon-only action names, and touch targets are inconsistent.
- Custom gesture and whole-card click handlers can make text selection and copying difficult.

### Component architecture

- shadcn primitives coexist with `S*`, `Pro*`, and hand-built component languages.
- Empty, loading, error, form, table, and dialog patterns are duplicated.
- Existing compatibility wrappers cannot be deleted in one pass because they carry business APIs.

## 4. Delivery Rules

### Stage commits

Each stage produces exactly one final Git commit. The implementation may be committed before review, but all review fixes for that stage are folded into the same commit with `git commit --amend --no-edit`.

Commit sequence:

1. `docs: plan pixishelf design upgrade`
2. `refactor(ui): establish pixishelf design foundations`
3. `refactor(ui): unify application navigation shells`
4. `refactor(ui): upgrade core gallery experiences`
5. `refactor(ui): align shadcn interactions and copy behavior`
6. `refactor(ui): migrate supporting gallery pages`
7. `refactor(ui): migrate admin workbenches`
8. `test(ui): complete design upgrade regression pass`

### Review gate

After every stage commit, an independent sub-agent performs a read-only review against:

- the scope and acceptance criteria in this plan;
- the latest Vercel Web Interface Guidelines;
- the installed `frontend-design`, `web-design-guidelines`, and `shadcn` skills;
- repository path, test, and worktree rules;
- regressions visible in the fixed stage commit and relevant tests.

The reviewer receives the immutable stage commit hash and reviews `git show <stage-commit>` or `git diff <stage-commit>^ <stage-commit>`, not the normally empty staged diff. The implementer confirms a clean worktree at review start and review end. Any amended commit produces a new hash that becomes the review target.

Review findings use these levels:

- **Must fix**: behavior regression, broken build/type/test, inaccessible core action, unsafe destructive action, mobile blocker, copy/selection regression, plan violation, or a new inconsistent design primitive.
- **Should fix**: visible inconsistency or maintainability issue contained to the stage.
- **Optional**: polish that may be deferred without compromising the stage objective.

The next stage cannot start while any must-fix finding remains. Must-fix changes are implemented, verified, and included by amending the stage commit. The reviewer is asked to re-check the correction when the resolution is not self-evident.

### Minimum verification per implementation stage

Stages 1–6 run these gates before their stage commit and again after must-fix corrections:

```bash
pnpm --filter @pixishelf/next lint
pnpm --filter @pixishelf/next typecheck
pnpm --filter @pixishelf/next test -- <affected-test-paths>
rg --files packages/pixishelf | rg '[A-Z]'
```

If no focused test exists, add one when the changed behavior can be tested economically; otherwise record the reason and run the package unit suite. Layout stages also inspect their listed representative routes at `1440x900`, `390x844`, and the short-height `1440x720` viewport. A failed command caused by a pre-existing issue is recorded with evidence and must not hide a new failure.

Stage-specific route checks:

| Stage | Representative routes                                                              |
| ----- | ---------------------------------------------------------------------------------- |
| 1     | the migrated state/primitives sample plus `/dashboard`                             |
| 2     | `/dashboard`, `/artworks`, `/artworks/[id]`, `/admin`, `/admin/artworks`           |
| 3     | `/dashboard`, `/artworks`, `/artworks/[id]`, `/viewer`                             |
| 4     | `/viewer`, `/login`, one touched table route, and one touched form/dialog route    |
| 5     | `/artists`, `/tags`, `/series`, `/settings`, `/login`, global error/loading states |
| 6     | `/admin`, management tables, scanning/history, and artwork import/media dialogs    |

### Change discipline

- Preserve business logic and data contracts.
- Prefer existing patterns before adding abstractions.
- Use semantic tokens in every touched UI file.
- Do not add new raw palette utilities where a semantic token exists.
- Do not add `transition-all`.
- Do not add `select-none` to content.
- Use `Link` for navigation and `Button` for actions.
- Keep ordinary files and directories lowercase kebab-case.
- Put new tests in nearby `__tests__` directories.

## 5. Stage 0 — Plan and Isolated Worktree

### Work

- Create an isolated worktree on `codex/pixishelf-design-upgrade`.
- Record the complete implementation and review process in this document.
- Confirm the source worktree remains clean.

### Acceptance

- The design worktree is independently addressable.
- The plan contains all confirmed decisions, stages, gates, commands, and non-goals.
- No application code changes are mixed into the plan commit.

## 6. Stage 1 — Design Foundations

### Global tokens

Update `app/globals.css` with a compact semantic system:

- canvas, surface, raised surface, and muted surface roles;
- restrained PixiShelf blue, hover/active states, and selection color;
- neutral foreground hierarchy and border hierarchy;
- success, warning, and destructive state roles;
- two application radius tiers and two shadow tiers;
- system sans and monospace font stacks;
- layout width tokens for gallery, standard, reading, and workbench contexts;
- motion durations and a global reduced-motion fallback;
- intentional text selection and tap behavior;
- semantic scrollbar colors.

### Layout primitives

Add reusable primitives under `components/layout`:

- `PageContainer` with `gallery`, `standard`, `reading`, and `workbench` variants;
- `PageHeader` for page title, description, metadata, and actions;
- `SectionHeader` for repeatable content sections.

### State primitives

- Add official shadcn `Empty`, `Spinner`, and `Alert` components using this mandatory sequence from `packages/pixishelf`: run `pnpm dlx shadcn@latest info`; inspect which requested components already exist; run `pnpm dlx shadcn@latest docs <components>` and open/read the returned official documentation; run `pnpm dlx shadcn@latest add <components> --dry-run`; run `--diff` for every existing file that could be changed; only then run `add`; read each generated file and the final Git diff.
- Never pass `--overwrite`, apply a preset, or migrate to Base UI without separate explicit user approval.
- Compose an application `PageState` for empty, error, and loading states.
- Migrate one low-risk existing surface to every new primitive so the API is proven rather than speculative.

### Acceptance

- Tokens compile under Tailwind v4.
- Normal text, links, button labels, and state-token foreground/background pairs meet the specified contrast target; Stage 1 records the checked pairs.
- New primitives are covered by focused tests.
- No route behavior changes.
- The migrated sample has no raw palette additions, nested interactive elements, or text-selection regression.

## 7. Stage 2 — Application Navigation Shells

### Global shell

- Rework the desktop header into compact, quiet navigation.
- Use semantic tokens and a restrained active state.
- Align the header, page toolbar, and page containers.
- Standardize user-facing terminology.

### Mobile shell

- Add bottom navigation for `首页`, `作品`, `沉浸浏览`, and `更多`.
- Move secondary destinations, admin, and settings into a shadcn Sheet.
- Keep contextual toolbars on detail routes.
- Add safe-area spacing and shared floating-action offsets.

### Admin shell

- Replace the narrow ungrouped rail with a grouped, scrollable workbench sidebar.
- Add a mobile current-module header and admin navigation Sheet.
- Preserve all current routes and permission behavior.

### Acceptance

- Current navigation remains visible and accurate on every route.
- No content is hidden behind fixed navigation at 390px.
- Admin modules can be switched directly on mobile.
- Core navigation is reachable by keyboard and does not rely on clickable generic elements.
- The document has one `main` landmark, a practical skip-to-content link, and `aria-current` on active navigation.

### Verification record

- `1440x900`: `/dashboard`, `/artworks`, `/artworks/50`, `/admin`, and `/admin/artworks` had no horizontal overflow; desktop navigation was visible, mobile navigation was hidden, and all four visible artwork-index containers shared the gallery axis.
- `390x844`: the same representative routes had no horizontal overflow; desktop navigation was hidden, the four-item bottom navigation was visible, and the artwork toolbar, filter summary, and main grid all used `16px` inline padding. The admin module Sheet measured `344x844`, all eleven links measured `44px` high, and the Sheet scroll region retained safe-area padding in its class contract.
- `1440x720`: all representative routes had no horizontal overflow; the admin sidebar measured `240px` wide with `overflow-y: auto`, a `656px` viewport, and `660px` scroll content.
- The real `/artworks/50` detail route was checked at desktop and mobile widths. Its dataset is below the media-anchor threshold, so the fixed media controls were additionally verified with the existing 120-media component fixture; AppShell and both fixed controls use `--app-mobile-navigation-offset`.
- `/change-password` was checked after dismissing the content warning and exposed exactly one visible `main` landmark with the skip target wrapping it.

## 8. Stage 3 — Core Gallery Experiences

### Artworks

- Replace shadowed artwork cards with an image-led grid.
- Consolidate search, filtering, sorting, count, and immersive browsing into a lightweight tool rail.
- Preserve virtualization, URL state, random seed behavior, and scroll restoration.

### Dashboard

- Keep the existing section order and content responsibilities.
- Align section headers, actions, artwork grids, and artist shelves.
- Remove nested link/button patterns and whole-card click handlers.
- Every new or reshaped Stage 3 control follows the official shadcn composition rules already established; Stage 4 cleans the remaining legacy surfaces rather than repairing new Stage 3 debt.

### Artwork detail

- Make media the primary page material.
- Establish a stable reading column for title, artist, source, tags, and description.
- Normalize back, edit, preview, and media navigation actions.
- Preserve playback, chapters, media optimization, and content warning behavior.

### Acceptance

- Artwork grids are cardless in normal display mode.
- Minimal display mode and virtualization remain correct.
- Titles and metadata can be selected without triggering navigation.
- Desktop and mobile screenshots share consistent axes and density.

### Verification record

- `1440x900`: `/dashboard`, `/artworks`, `/artworks/50`, and `/viewer` had no horizontal overflow and no nested link/button combinations. The artwork index rendered six image-led columns with selectable title and artist metadata; dashboard retained `最新作品` → `热门艺术家` → `推荐作品`; the detail page used the `720px` reading axis without a card shell; Viewer media measured `420x810` within its `90dvh` frame.
- `390x844`: dashboard and artwork index rendered two `164–166px` columns without document overflow. Artwork detail retained one main landmark and aligned reading toolbar/content. Viewer exposed `44x44px` back and filter controls inside the top safe area, had no overflow, and kept title, artist, and tags as unnested links.
- The mobile Viewer filter Drawer measured `390x717`, exposed a labelled and described dialog, and stayed within the viewport. The Viewer tag panel was migrated to the official shadcn Drawer composition; existing filter behavior and media gestures were preserved.
- `1440x720`: dashboard, artwork index, artwork detail, and Viewer had no horizontal overflow or nested interactions. Viewer media measured `648px` high (`90dvh`) and fit entirely within the viewport.
- Focused coverage verifies card metadata is outside the cover link, minimal display remains image-only, virtualization/query behavior is preserved, detail image virtualization remains intact, and Viewer navigation/actions use the expected links and buttons.

## 9. Stage 4 — shadcn and Interaction Convergence

### Components

- Add required official primitives only after checking installed components, docs, dry-run, and diffs.
- Adopt Field/InputGroup patterns for touched forms.
- Fix SelectGroup, Dialog/Sheet titles, Avatar fallbacks, Card composition, and icon usage.
- Restrict new use of `S*` and `Pro*` wrappers; keep compatibility where required.

### Interaction semantics

- Replace clickable `div` and `span` navigation with `Link`.
- Replace generic action containers with `Button`.
- Move custom overlays to Dialog, Sheet, or Drawer where appropriate.
- Give icon-only controls a useful name or tooltip.
- Standardize destructive confirmation hierarchy.

### Selection and copying

- Remove content-level `select-none` and event interception that blocks selection.
- Keep `select-none` only for menus, drag handles, sliders, and other genuine controls.
- Add explicit copy actions for IDs, URLs, paths, log values, and table values.
- Keep existing media gesture and context-menu behavior.

### Acceptance

- No core navigation action in the reviewed scope uses a clickable generic element.
- Touched forms have connected labels and local errors.
- Copyable content works through selection and explicit copy actions.
- No shadcn component is overwritten without reviewed diffs.

### Verification record

- Added the official shadcn `InputGroup` source only after checking component info, documentation, examples, dry-run output, and diffs. The CLI was allowed to stop at its overwrite prompt; existing `Button`, `Input`, and `Textarea` files were not overwritten.
- All ten production Select surfaces found by the audit now group their `SelectItem` children with `SelectGroup`; affected test doubles were updated to reflect the official composition.
- Login and initialization forms use connected Field labels, local field errors, appropriate `name` and `autocomplete` attributes, and leave native selection, copy, and paste behavior untouched. The APNG surface is now a labelled native button rather than a clickable `div`.
- The log viewer keeps virtualized, selectable log messages, uses labelled shadcn controls, and adds an explicit copy action for all or currently filtered entries with a direct-selection fallback.
- The Stage 4 review gate additionally verified that complete log rows remain selectable, destructive log clearing requires confirmation, invalid custom forms focus their first failing field, and APNG toggles use stable, item-specific names.
- Browser checks at `1440x900`, `390x844`, and `1440x720` found no horizontal overflow or nested interactive controls on `/login`. It retained exactly one `h1`; the mobile marketing panel collapsed; inputs remained selectable; empty submission connected both visible errors through `aria-describedby`.
- `pnpm --filter @pixishelf/next lint` completed with zero warnings/errors, TypeScript typecheck passed, and six focused test files passed across forms, log copying, APNG semantics, pagination, preferences, and artwork filtering. The final full unit suite passed all `159` files / `848` tests after adding a runtime-safe null-path fallback exposed by the aggregate run and the review-gate destructive-action coverage.

## 10. Stage 5 — Supporting Gallery Pages

Migrate:

- artists and artist detail;
- tags, tag explorer, and tag detail;
- series and series detail;
- settings, profile, preferences, and change password;
- login and initialization;
- global loading, error, and not-found states.

### Acceptance

- All supporting pages use the shared containers and heading hierarchy.
- Gallery content remains image-led and ordinary sections are not over-carded.
- Forms use the shared form language.
- Empty, loading, and error states use the shared state language.

### Verification record

- Artists, artist detail, tags, tag detail, series, settings, profile, preferences, change password, and login now share the gallery/standard/reading container axes and the `PageHeader` / `SectionHeader` hierarchy. Artist and series cards use separate cover and title links, leaving counts, usernames, and dates directly selectable.
- The login entry keeps the confirmed blue/white direction but replaces the generic blue-purple blobs with a restrained work-index motif. Profile and password forms use Field/InputGroup, connected labels, local errors, autocomplete attributes, and first-invalid-field focus. The base Label no longer blocks mouse text selection.
- Tags retain search, popular/random modes, the animated index, grid mode, throttled infinite loading, and URL navigation. Reduced-motion users receive a static wrapping index. The obsolete local Tabs implementation was removed in favor of the official shadcn Tabs composition.
- Browser checks covered `1440x900`, `1024x768`, `390x844`, and `1440x720` across `/artists`, `/artists/4`, `/tags`, `/tags/33`, `/series`, `/settings/profile`, `/settings/preferences`, `/change-password`, `/login`, and a real not-found route. Each checked route had one `main`, one `h1`, no nested interactive controls, and no horizontal overflow. A real 1px mobile overflow in the artist sort trigger was fixed and rechecked with zero offending elements.
- The local series fixture is empty, so the browser run verified the shared series empty state; separate component coverage verifies populated series-card link and selectable metadata structure. Tag search returned real results without changing the page landmark or interaction structure, and focused coverage verifies recoverable error plus successful-empty states. Empty password submission focused `currentPassword` and connected its visible error through `aria-describedby`.
- Global loading, error, and not-found entries already use `PageContainer` plus `PageState`; the real 404 route was checked on mobile. The review gate additionally removed new `space-y-*`, moved series counts outside navigation, added Field disabled state, normalized Button icons and semantic overlay colors, and expressed password strength through a Progress variant. `pnpm --filter @pixishelf/next lint` completed with zero warnings/errors, TypeScript typecheck passed, and the final full unit suite passed all `164` files / `856` tests.

## 11. Stage 6 — Admin Workbenches

Migrate admin modules in functional groups:

- statistics and navigation overview;
- artwork, artist, tag, series, and user management;
- archive, scanning, scan history, and tasks;
- image management, import, replacement, ordering, and media dialogs.

### Workbench rules

- Tables remain compact on desktop and horizontally contained when necessary.
- Sort headers and row actions use native controls.
- Statuses use semantic Badge/Progress roles.
- Mobile supports navigation, viewing, filters, and light actions.
- Complex batch workflows remain desktop-optimized and explain that constraint instead of breaking at small widths.
- Large files are split only when a clear business boundary exists; this stage does not authorize unrelated service refactors.

### Acceptance

- Every admin route uses the workbench shell.
- No admin module is unreachable on mobile.
- Destructive actions have consistent confirmation and consequences.
- Table values and logs remain selectable and copyable.

### Stage 6 execution record

- Every admin route now uses the shared workbench hierarchy, with a grouped desktop sidebar and the same eleven destinations available from the mobile module Sheet. Overview, statistics, content management, archive, scan, task, settings, and batch-media workflows share the same title, section, metric, table, status, and feedback vocabulary.
- Destructive admin actions now use the shared confirmation flow, while recoverable operations remain lightweight. Table values, identifiers, logs, and filter content remain selectable; explicit copy controls provide feedback without blocking ordinary mouse selection.
- Complex artwork import and replacement tools remain desktop-optimized but are horizontally contained and give mobile users explicit viewing/light-action guidance. Browser checks at `1440x900` and `390x844` covered the admin overview, artwork management, batch replacement, settings, and tasks: each route had one `main`, one `h1`, a white body background, no document-level horizontal overflow, and reachable mobile navigation.
- `pnpm --filter @pixishelf/next lint` completed with zero warnings/errors, TypeScript typecheck passed, and the full unit suite passed all `165` files / `866` tests.

## 12. Stage 7 — Regression and Final Cleanup

### Automated verification

Run from the design worktree:

```bash
pnpm --filter @pixishelf/next lint
pnpm --filter @pixishelf/next typecheck
pnpm --filter @pixishelf/next test
pnpm --filter @pixishelf/next build
```

Use escalated execution for the Next.js build as required by the repository guide.

### Visual and interaction verification

Check at minimum:

- 1440px desktop;
- 1024px compact desktop/tablet;
- 390px mobile;
- a short-height desktop or landscape viewport.

Exercise:

- login and initialization;
- global and mobile navigation;
- artwork search, filter, sort, virtualization, and scroll restoration;
- artwork detail and Viewer;
- settings forms;
- admin navigation, tables, dialogs, destructive actions, and copy actions.

Use reproducible seeded/local data containing at least: a multi-image artwork, video/APNG media, populated and empty collections, long Chinese/Latin titles, long paths/IDs, an artist with and without an avatar, active filters, table pagination, and a destructive-action candidate. Record unavailable fixture states instead of silently skipping them.

### Repository checks

```bash
rg --files packages/pixishelf | rg '[A-Z]'
rg -n --glob '*.tsx' --glob '*.css' 'transition-all|space-[xy]-|select-none' packages/pixishelf
```

Each remaining match must be justified as an intentional control behavior or migrated before completion.

### Acceptance

- No unresolved must-fix review findings.
- No unexpected horizontal scrolling at target widths.
- No regressions in core business flows.
- All stage commits remain scoped and reviewable.
- The final worktree is clean.

### Stage 7 execution record

- Final cleanup migrated the remaining touched admin dialogs to `FieldGroup` / `Field`, replaced production `space-x/y` and `transition-all` usage with explicit flex gaps and property-scoped transitions, named the remaining business inputs, and kept `select-none` only on shadcn menu/calendar/slider primitives plus genuine drag, long-press, and button controls. Ordinary titles, paths, table values, logs, and metadata remain mouse-selectable.
- The final review cycle also converted artwork search suggestions and preview pagination to named native controls, connected the filter Sheet and artwork editor's composite fields to visible labels, separated the date clear action from its trigger button, switched the Sheet between bottom and right placement at the real breakpoint, and removed the media-order dialog's nested `main`. Focused regression coverage now locks those semantics in place.
- Browser regression covered `1440x900`, `1024x768`, `390x844`, and `1440x720` across Dashboard, artworks, a real multi-image detail (`/artworks/50`), artists, tags, settings, Viewer, and the main admin workbenches. Every checked route used a white body background, one `main`, one `h1`, and no document-level horizontal overflow. The run additionally opened the artwork filter Sheet, verified active-filter clearing, exercised a real Viewer item containing image/video media, opened and cancelled a destructive artist deletion, verified the admin dialog Field structure, and received the `已复制` toast from a table ID copy action.
- The configured local account makes first-admin initialization and the unauthenticated login screen unavailable in this signed-in browser session; the focused login/initialization form suite and the final full unit suite cover those states. The local catalog supplied populated/empty lists, long Chinese/Latin titles and identifiers, multi-image and video media, but no confirmed APNG fixture. Browser-driver history-back was unavailable, so scroll restoration could not be repeated end-to-end; the existing restoration implementation was left unchanged and its surrounding list suite passed.
- `pnpm --filter @pixishelf/next lint` completed with zero warnings/errors, TypeScript typecheck passed, all `166` unit-test files / `869` tests passed, uppercase-path and diff checks were clean, and a production `next build` completed successfully with the expanded local environment and no database authentication errors.

## 13. Non-goals

- Database, Prisma schema, API, TRPC, scanner, archive worker, or media pipeline redesign.
- Pixiv brand copying, asset copying, or page-for-page imitation.
- shadcn preset application or a Base UI migration.
- A full dark-theme rollout.
- A bespoke screen-reader mode or exhaustive ARIA instrumentation.
- Full mobile parity for drag-heavy and batch-heavy administration workbenches.
- Unrelated refactors discovered while touching UI files.
