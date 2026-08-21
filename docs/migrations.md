# Zero-Downtime Database Migrations

To ensure our application can be deployed without taking down the production API, all database migrations must follow the **Expand/Contract** pattern. This means schema changes must be reversible and safe against both the old and new versions of the application.

## The Expand/Contract Pattern

Never mutate or drop a column/table that is currently in use by the running application. Instead, break the change down into multiple backward-compatible phases across different releases.

### Example: Renaming or Changing a Column

1. **Expand (Release 1):** 
   - Add the new column or table.
   - Update the application code to **dual-write** to both the old and the new columns, but continue reading from the old column.
2. **Backfill:**
   - Run a script or background worker to migrate existing data from the old column to the new column.
3. **Transition (Release 2):**
   - Update the application to **read** from the new column. The old column is no longer read from but may still be written to (if needed for rollback).
4. **Contract (Release 3):**
   - Drop the old column in a later release once it is guaranteed that the old application version is no longer running and no rollbacks will occur.

## Rules and Enforcement

- **No Destructive Operations in a Single Migration:** Do not use `dropTable`, `dropColumn`, `renameColumn`, or similar destructive Knex schema builder commands alongside other changes. Destructive commands should be isolated to a "contract" phase migration.
- **Always Include a `down` Migration:** Every migration file must export a `down` function that cleanly reverts the changes made in the `up` function. This makes `npm run migrate:rollback` a viable recovery path if a deployment fails.
- **CI Validation:** The Continuous Integration pipeline enforces that every migration can be applied and rolled back successfully across our supported databases (SQLite and Postgres). A custom guard (`scripts/check-migrations.js`) will block PRs that attempt destructive changes in a single migration.

## Running Migrations

To apply the latest migrations:
```bash
npm run migrate
```

To rollback the last batch of migrations:
```bash
npm run migrate:rollback
```
