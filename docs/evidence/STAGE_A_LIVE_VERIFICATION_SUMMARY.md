# Stage A live-verification evidence summary

The sanitized read-only capture is classified **currently live-verified with
timestamp and project provenance** only as of `2026-08-02T15:11:27.763Z`.
Expected project ref, linked metadata ref, and the project marked `linked: true`
by the Supabase CLI all equal `xivewedajschthjlblfb`.

The external bundle is at
`/Users/alex/Desktop/Cockpit Stage A Live Evidence`. The repository retains the
sanitized provenance manifest and claim projection, not credentials or link
metadata. Every required external artifact is mandatory when the evidence
checker receives `--external-dir`; missing files fail closed.

## Exact read-only commands

- `supabase projects list --output json`
- `supabase migration list --linked`
- `supabase db push --linked --dry-run`
- `supabase functions list --project-ref xivewedajschthjlblfb --output json`
- `supabase db lint --linked --level error`
- `supabase db dump --linked --schema public,extensions --file [EXTERNAL_EVIDENCE_TEMP_FILE]`
- `gh api repos/AttractAcq/Cockpit/commits/main --jq .sha`
- `gh api repos/AttractAcq/Cockpit/pages`
- `gh api --method GET repos/AttractAcq/Cockpit/contents/.github/workflows/deploy.yml -f ref=main`
- `gh run list --repo AttractAcq/Cockpit --workflow deploy.yml --branch main --status success --limit 1 --json databaseId,headSha,status,conclusion,createdAt,updatedAt,url,workflowName,event`
- `curl -sS -o /dev/null -w [JSON_STATUS_FORMAT] https://attractacq.github.io/Cockpit/`

The machine-readable manifest preserves the exact shell-safe quoted command,
UTC start/finish, tool/version, exit status, sanitized raw stdout/stderr, target
mode, actual project ref where applicable, and output artifact hash for every
component.

## Parsed claims

| Claim at capture time | Artifact SHA-256 |
|---|---|
| 47 paired local/remote migrations | `migration-list.txt`: `6aaab205d7b900f7483e3a5dfcd9ca07b2f284858606decf596219bc56d189d5` |
| Linked push dry run reported the remote database up to date | `db-push-dry-run.txt`: `1b20ae82a9a4465f73d54c46884a074e1d34884be339675279196562e1f1dbdd` |
| Linked database lint returned zero error-level findings | `db-lint.txt`: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| 50 unique deployed Edge Functions | `functions-list.json`: `c5936c6ae09c15a20fe653c7a301238303aa68263f09ba7a90941b72823b15b2` |
| Public/extensions schema-only dump captured | `remote-schema.sql`: `09a2aaf0d8b65e3954b2e6704f59f99025e05a029905d697614641c575577f5a` |
| Cockpit main SHA was the frozen base | `cockpit-main-sha.txt`: `d65fe36f5159ca14a5e8a33018bf973932b7b8e6515f1c926a85a28b88b87b7e` |
| Pages configuration was readable | `pages-config.json`: `cdddaab5804af1ac0151944e413c24a8765a4a3402176fcf4d61f178e15ad5bb` |
| Main deployment workflow bytes were captured | `pages-deployment-workflow.yml`: `2edff298c816a8665827a7a6aed966f5426dc0f9c41a9e5035deac5b8467a883` |
| Latest successful Pages run used the exact frozen-base SHA | `pages-main-deployment-run.json`: `e965f715d3166c30eda5373edc484e71d1451531bd53c82e441bba2692ebc95b` |
| Live Pages response was HTTP 200 | `pages-http-response.json`: `a3023974a615161d8950a77c46c9898c7d8cdeddf9f268b3efd7725f85470b79` |

The provenance transcript SHA-256 is
`76aeb1c14d35e20b78fe9a951280fd20aa60f5a616584e14cd1f9e414febc8b0`;
the provenance manifest SHA-256 is
`87ecf5bc13565f877f84ff143a4469a20d5cfab71a3441e4ec210d6ec3771506`;
the external `evidence-sha256.txt` SHA-256 is
`17b5b45357c1253258f9432dd3a736c4610630fe8486bc283853c3b765f01a83`.

## Local evidence boundary

Local build, Node 20 CI, stability, read-only, and disposable PostgreSQL claims
are not live claims. Their exact current transcript hashes, commands, UTC
bounds, totals, and component statuses are read from
`stage-a-local-verification/verification-manifest.json`; the values are not
copied into this fingerprinted summary. Final test, stability, read-only, and
Node 20 CI evidence use the versioned test-source binding. Disposable PostgreSQL
evidence uses the separate versioned database-source binding, including exact
runner/configuration/SQL/manifest/migration hashes and component input mappings.
The standalone build transcript has transcript integrity and command/result
evidence but does not claim either source-binding schema. Database behavioral
integration is representative and named, while the rebuilt catalogue comparison
is limited to the documented identifier multiset.

The local manifest also preserves a fresh-checkout portability proof. UTC
transcript bounds record execution time, while deterministic path-and-byte
source bindings identify the tested inputs. Checkout-local filesystem times are
not evidence-validity inputs and cannot stale byte-identical evidence.
