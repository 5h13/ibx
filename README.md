# IBX Environment / Cumulative Build — Typecheck Fix 2

This build is cumulative from the IBX Shared Core / Cross-Module Integration build and includes the environment foundation plus the fixes identified by the user's real `npm run typecheck` run.

Fixed in this revision:
- Fleet trip audit detail uses `tripNo` correctly.
- Procurement `chooseItem` no longer references an out-of-scope `setLine`.
- Logistics location status supports `active` / `inactive` in `StatusBadge`.
- Logistics reporting dashboard has explicit inventory/location row types so low-stock and location-stock fields are correctly typed.

Run locally:

```powershell
npm install
npm run typecheck
npm run build
```

The local environment should be used for the authoritative Next.js/TypeScript verification. Do not run `npm audit fix --force` before the application build is passing; dependency upgrades should be handled as a separate hardening step.
