# Frontend rules

Read `../AGENTS.md` first. These rules apply to all frontend files.

## Strict shadcn/ui usage

- Use shadcn/ui components from `@/components/ui` for buttons, fields, menus, dialogs, selects, tables, navigation and other component-level UI.
- `components.json` is authoritative: `base-nova`, Base UI primitives, Lucide icons, neutral CSS-variable theme, `@/` aliases and `src/index.css`.
- Inspect existing components before adding one. Use the project's installed shadcn CLI from this directory, for example `pnpm exec shadcn add input`. Review generated files and dependency changes. Do not overwrite customized components blindly.
- Do not install or mix Material UI, Ant Design, Chakra, Bootstrap, Mantine, another UI kit, or Radix implementations copied from a different shadcn preset.
- Do not hand-build replacements for shadcn controls. If a component is missing, add its matching shadcn component or compose existing components. If no supported composition satisfies the requirement, explain the gap before adopting an alternative component system.
- Base UI imports belong in the matching shadcn primitive wrappers in `src/components/ui/`, not ad hoc controls in business screens.
- Semantic HTML for page structure, text, forms and receipt markup is allowed. Tailwind layouts, business compositions, theme providers, and Lucide icons are allowed; “strict shadcn” does not mean every paragraph must be a generated component.
- Keep `src/components/ui/` reusable and free of POS-specific API calls or business state. Put business components in feature folders or `src/components/`.
- Keep React component exports separate from styling-function exports for Fast Refresh. The Button uses `button-variants.ts`; import `buttonVariants` there when composing styles. Preserve this separation when updating generated shadcn files.

## UI and interaction

- Use theme tokens such as `bg-background`, `text-foreground`, `text-muted-foreground` and `border-border`; avoid arbitrary per-screen palettes.
- Keep the current font, theme and component style consistent unless the task changes the design system. Match the local formatter (double quotes, no semicolons).
- Preserve semantic labels, accessible names, visible keyboard focus, dialog focus handling and error descriptions. Icon-only actions need accessible names.
- Cashier interactions must support keyboard/scanner input; manager screens must work on a narrow phone viewport. Test affected layouts in both light and dark themes when supported.
- Do not add global single-letter shortcuts that conflict with typing or scanning. The starter's global `d` theme shortcut needs evaluation before a cashier screen uses it.
- Show pending/failed/unknown payment and save states accurately. Do not optimistically show a finalized sale or confirmed payment before the backend confirms it.
- Use browser storage only for appropriate preferences/drafts. Do not store database credentials, long-lived authentication secrets or authoritative sale records there.

## Structure and checks

Use feature-oriented modules as functionality arrives; avoid putting the whole POS in `App.tsx`. Keep API access separate from rendering and reuse typed response/error handling.

Run from `frontend/` (on Windows, use `pnpm.cmd` if PowerShell blocks the shim):

| Purpose | Command |
| --- | --- |
| Install exact dependencies when needed | `pnpm install --frozen-lockfile` |
| Development | `pnpm run dev` |
| Lint | `pnpm run lint` |
| Referenced-project type check | `pnpm run typecheck` |
| Production build, including type check | `pnpm run build` |
| Check formatting of changed files | `pnpm exec prettier --check <changed-files>` |

The `pnpm run typecheck` command executes `tsc -b` to traverse the application and tooling project references. Do not replace it with a bare `tsc --noEmit` against the empty root file list. A successful production build already covers the build-mode TypeScript check; no need to repeat it unnecessarily.

No frontend test runner is configured yet. Add an appropriate test setup with the first interactive business feature; do not claim frontend tests exist or pass today. Run a browser/visual check for material UI changes and report if unavailable. Vite preview is a local check, not a production hosting service.
