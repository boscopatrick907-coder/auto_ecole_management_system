# Review of Willy's 17 November delivery

Reviewed commit: `e9bc3d88c1957716f4000bf5ce06d060d81da0b4` on `willy/w01-staging-integration`. This is offline authorization/cache handling and pagination work. It does not contain the newer WI-N1 receipt renderer assignment. The branch is based on `b5cbc1b`, before the content portal, quiz drafts, synchronization page and newer pagination on main. Do not merge it by replacing current files wholesale.

## Checks executed on that exact branch

- Frontend strict TypeScript check: passed.
- Angular production build: passed.
- Existing frontend unit suite: 23 tests passed.
- Existing Chromium fixture suite: 9 scenarios passed.
- Three additional account-switch regression checks: **all three failed**, reproducing the findings below.

These are local tests with synthetic identities/files. No deployed school data or private account was accessed. There is no evidence here of real R2, phone or deployed-stack acceptance.

## Findings requiring correction before integration

### WR-1 — P1: a late denial can invalidate the replacement account

In `frontend/src/app/core/api.service.ts:91–99`, the authorization error hook uses the current slug/handler when an earlier request completes. It does not bind the denial to the user who issued that request.

Reproduction: user A requests `/schools/school/me`; switch to user B in the same school before the response; A's response returns 401. The authorization callback is still invoked, and `DataService.handleApiDenial` selects B's current scope. B's caches/session can be cleared even though the denial belonged to A.

Required correction: capture request identity/school before fetch; propagate that immutable context and recheck it before invalidation. An old response may fail its own operation but must not invalidate the replacement account.

### WR-2 — P1: cached material can be returned across an account switch

In `frontend/src/app/core/data.service.ts:95–117`, `file()` captures A's scope, awaits lease refresh, then tests the current account's offline entitlement and returns a blob from A's captured scope without checking identity again.

Reproduction: cache a synthetic private file for A; change to B while `refreshLease()` is pending; let B pass `offlineAllowed()`. `file()` returns a blob URL containing A's cached material rather than rejecting the stale operation. This is a client-side scope failure, not evidence that database RLS was bypassed.

Required correction: recheck the original identity after every relevant await, including refresh, lease verification, cache lookup, signed-URL response and body download. Reject stale operations and never return/cache their bytes under the new account.

### WR-3 — P2: a late lease is stored under the wrong account

In `frontend/src/app/core/auth.service.ts:302–326`, `refreshLease()` captures a scope for the error path but writes successful responses under `this.scope` after awaiting the request.

Reproduction: request a lease for A, switch to B, then resolve A's request. A's token is stored as `school:user-b:lease`. Signature/subject verification should subsequently reject it, so this is not proof of a forged authorization grant; it contaminates the new account's cache and can break offline access.

Required correction: capture scope/slug/user before the request and check they still match before any write; use the captured key only after the check. Test both successful and denied late responses.

## Willy's next handback

1. Rebase/port the useful authorization fixes onto current main without removing the portal, durable drafts, scoped queue review or existing pagination.
2. Correct WR-1–WR-3 and retain permanent regression tests. The existing student-page/cache-key implementation on main differs from this older branch; adapt invalidation to the current keys.
3. Run all current main tests plus the added regressions, builds and Chromium scenarios. Report exact commit and separate fixture/device/staging results.
4. WI-N1 [receipt quality and phone acceptance](WILLY_NEXT_TASK_20261117.md) remains unimplemented in the inspected commit. Finish it after the scope fixes, or provide the separate branch/PR if receipt work exists elsewhere.

## Reproduction fixture

The standalone fixture is [willy-scope-races.test.ts.txt](review-fixtures/willy-scope-races.test.ts.txt). It is intentionally outside the normal test suite because it targets APIs on the reviewed, unmerged branch. To reproduce on that branch in an isolated checkout/session, copy it to `frontend/tests/willy-review-races.test.ts` and run from `frontend`:

```sh
./node_modules/.bin/vitest run tests/willy-review-races.test.ts
```

Expected current result: three failing assertions. Keep the corrected regressions in the normal suite when integrating the fixes. Do not suppress or mark these assertions skipped to make the suite green.

## Disposition

Not approved for merging unchanged. No Willy implementation code was merged by this review. Main was restored after testing. This report and fixture are the repository handoff; no direct message to Willy is implied.
