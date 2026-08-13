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

- `Archive Canvas` `#F5F7FA`: the cool page background around media and workbenches.
- `Paper Surface` `#FFFFFF`: controls, dialogs, forms, and bounded work surfaces.
- `Gallery Ink` `#1F2937`: primary text and high-emphasis utility data.
- `Quiet Slate` `#6B7280`: descriptions, counts, and secondary metadata.
- `PixiShelf Accent` `#0096FA`: the archive index marker, focus treatment, selection tint source, and other non-text brand accents.
- `Signal Red` `#C8323C`: destructive actions and genuine failure states only.

Interactive text and filled actions use a darker `Action Blue` `#0076C9`, not the brighter accent token. On white, `#0076C9` has approximately `4.74:1` contrast; white on `#0076C9` has the same ratio. White on `Signal Red #C8323C` has approximately `5.28:1` contrast. The bright `#0096FA` accent is never used for ordinary small text or as a white-text button background. Token foreground/background pairs must maintain at least `4.5:1` for normal text and control labels.

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

| Stage | Representative routes |
| --- | --- |
| 1 | the migrated state/primitives sample plus `/dashboard` |
| 2 | `/dashboard`, `/artworks`, `/artworks/[id]`, `/admin`, `/admin/artworks` |
| 3 | `/dashboard`, `/artworks`, `/artworks/[id]`, `/viewer` |
| 4 | `/viewer`, `/login`, one touched table route, and one touched form/dialog route |
| 5 | `/artists`, `/tags`, `/series`, `/settings`, `/login`, global error/loading states |
| 6 | `/admin`, management tables, scanning/history, and artwork import/media dialogs |

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

## 13. Non-goals

- Database, Prisma schema, API, TRPC, scanner, archive worker, or media pipeline redesign.
- Pixiv brand copying, asset copying, or page-for-page imitation.
- shadcn preset application or a Base UI migration.
- A full dark-theme rollout.
- A bespoke screen-reader mode or exhaustive ARIA instrumentation.
- Full mobile parity for drag-heavy and batch-heavy administration workbenches.
- Unrelated refactors discovered while touching UI files.
