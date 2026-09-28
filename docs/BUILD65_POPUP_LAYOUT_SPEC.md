# Build 65 — universal "main information first, actions in pop-ups" layout

User requirement (verbatim): "the button arrange we did with the catalog should apply universally. opening the tab should show main information, then other actions like adding, etc, should be inside buttons that opens pop-up windows"

Reference implementation: the Catalog tab in `src/modules/finance/procurement/ProcurementManagement.tsx`
(toolbar of buttons at the top: "+ Add catalog item", "Pricing rules", "Supplier relationships"; the table is the first content).

## Shared component — use it, do not write new modal markup
`src/core/ui/PopupAction.tsx`:
```tsx
import { ActionBar, PopupAction } from '@/core/ui/PopupAction';

<ActionBar>
  <PopupAction label="+ Add customer" title="Add customer" notice={message}>
    {(close) => (
      <form action={fd => run(async () => { await createCustomerAction(fd); close(); })} className="…">
        …existing fields unchanged…
      </form>
    )}
  </PopupAction>
  <PopupAction label="Record receipt" title="Record customer receipt" variant="secondary" notice={message} wide>
    {(close) => …}
  </PopupAction>
</ActionBar>
```
- `label`: button text. Use "+ " for add/create (e.g. "+ Add customer", "+ New policy"); plain verbs otherwise ("Record receipt", "Upload document").
- The FIRST/main action of a page is `variant="primary"` (default); the others `variant="secondary"`.
- `wide` for big forms (line-item editors, many fields).
- `notice={…}`: pass the page's existing message state (whatever it is named: message, msg, notice, error…) so success/error text shows inside the pop-up. If the page reports errors with `dialog.alert(...)` instead, omit `notice`.
- Close after success: use the render-prop `(close) => …` and call `close()` right after the awaited server action succeeds (at the point where the existing code resets the form / sets a success message). Never call it in the error path. If the existing handler is wrapped in a helper like `run(fn)` that catches errors, put `close()` inside `fn` after the `await`.

## Rules
1. A page/tab must OPEN on its main information: registers, tables, lists, KPIs/dashboards, detail views.
2. Move into PopupActions every form/section that ADDS or CHANGES data and currently sits inline on the page: add/create/new/record/register/log/upload/request/issue/submit/schedule/assign/settings-style forms, master-data maintenance forms, bulk import forms.
3. Put all of a page's (or tab's) PopupAction buttons together in ONE `<ActionBar>` at the TOP of that page/tab — right under the page heading / tab strip, above the main information. If the page has tabs, each tab gets its own ActionBar with only that tab's actions.
4. KEEP INLINE: search boxes, filters, date-range pickers, report selectors, pagination, and export/download links (links may stay where they are or join the ActionBar as plain `<a className="button-secondary">`).
5. KEEP AS IS: per-row actions (buttons in table rows), and existing row-level edit/detail modals (`fixed inset-0` markup already present) — do not rebuild them.
6. Role/permission conditions that currently show or hide a form must now show or hide its button the same way (`{canX && <PopupAction …>}`).
7. Do NOT change behaviour: same fields, names, defaults, validation, server actions, state, and data loading. Only move JSX and add the close-on-success call. Do not rename exports or props. Do not edit server actions, pages under `app/` (unless the form is in the page file), migrations, or other modules.
8. If a card/heading only existed to wrap the moved form, drop that wrapper (the pop-up title replaces it). If a card mixes a form and a list, move only the form.
9. If a module's form state (e.g. line items, selected ids) must reset when the pop-up opens, leave it as it is — do not add new state logic.
10. Many files are written on very long single lines. Edit carefully with exact string replacement (Python or the Edit tool), re-read the result, keep the code compiling.
11. When done with your files run `cd /home/claude/b51 && npx tsc --noEmit` and fix every error in your files. Do NOT run `npm run build`, `npm ci` or dev servers (other people are editing the same tree in parallel; the build is run once at the end).
12. Report per file: which forms moved into which buttons, what stayed inline and why, anything you were unsure about.
