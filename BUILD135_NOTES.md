# Build 135 — month pickers load the month as soon as it is chosen

Deploy: commit and push (no database change). Checks: TypeScript clean, `next build` passes.

- Dashboard (layer 2) and Sales → Monthly Sales: choosing a month in the picker loads it at once; the Show button is gone.
- Shared picker: `src/core/ui/MonthPicker.tsx` (a plain GET form that submits itself on change; a Show button remains only for browsers without JavaScript).
