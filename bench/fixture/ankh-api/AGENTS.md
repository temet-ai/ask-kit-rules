# ankh-api

Run `scripts/start-api.sh` to start the API on port 8080.

## Testing

- Run `npm test` before every commit.
- Write a failing test before fixing a bug.
- Keep each test under two seconds.

## Shipping a change

- Merge to main through a pull request; never push to main.
- Deploy with `scripts/deploy-staging.sh`, then check `/health`.
- The release checklist lives in `docs/release-checklist.md`.
- Use the `watchman` skill to review a pull request.
