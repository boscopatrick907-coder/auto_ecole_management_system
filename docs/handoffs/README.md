# Handoffs — 9 November 2026

Review base: **8ce436f** on main. These documents review the combined repository, not only Emmanuel's commits. They do not certify a deployed service or an unseen environment file.

| Reader | Document | Purpose |
|---|---|---|
| Emmanuel | [Backend, database and configuration](EMMANUEL_BACKEND_AND_CONFIGURATION.md) | Prioritized corrections, staged migration, environment bindings and proof required |
| Willy | [Frontend and integration](WILLY_FRONTEND_AND_AI_AGENT.md) | Remaining UI/offline/integration work and a ready-to-use AI coding agent prompt |
| Customer / Patrick | [School onboarding checklist — French](CUSTOMER_SCHOOL_ONBOARDING_FR.md) | Information to request from each school, without requesting secrets or unnecessary identity documents |
| Patrick / team | [Roadmap and release gates](ROADMAP_AND_RELEASE_GATES.md) | What exists, what is verified, current launch scope and remaining gates |
| Emmanuel / Patrick | [Testing environment assessment](TEST_ENVIRONMENT_REVIEW.md) | Why the last shared legacy env is insufficient for the tenant Worker, and how to validate a replacement |

## Delivery

The shared repository is the delivery channel for these handoffs. Publishing a file does not prove a named collaborator has read it. No email, Slack message or GitHub assignment was sent by this change.

Ready-to-forward message for Emmanuel:

> Please pull the latest main and start with docs/handoffs/EMMANUEL_BACKEND_AND_CONFIGURATION.md and TEST_ENVIRONMENT_REVIEW.md. The product is one deployment for many schools. Confirm which entry point/schema your running service uses. Resolve the P0 items on a disposable Neon branch, provide redacted test results, and coordinate the staging API contract with Willy before any production migration. Do not put an owner connection string in Worker bindings.

Ready-to-forward message for Willy:

> Please pull main and follow docs/handoffs/WILLY_FRONTEND_AND_AI_AGENT.md. Keep the existing Stitch design and tenant model. Use your AI coding agent one task at a time, add meaningful regressions, and replace fixture-only browser acceptance with end-to-end tests against Emmanuel's staging tenant Worker. Do not recreate Supabase or the legacy bearer-token client.

Emmanuel owns backend/schema/configuration changes; Willy owns frontend UX and browser/device integration. Coordinate API-contract changes rather than editing each other's areas independently. Each handoff has evidence and completion criteria.
