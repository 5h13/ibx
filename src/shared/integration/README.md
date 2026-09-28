# Shared Core / Cross-Module Integration

This layer is cumulative on top of the Approvals / Decision Engine build.

It provides:
- a workflow registry describing the supported operational workflows;
- a cross-module integration event trace that does not replace source-module transactions;
- a server-side event recorder used by the central approval engine;
- a Super Admin-only Integration Control Center at `/integration`;
- module coverage, record counts, workflow states, integration event health and recent audit activity.

The source module remains authoritative for business records and status. The integration event table is an observability/trace layer for cross-module handoffs.
