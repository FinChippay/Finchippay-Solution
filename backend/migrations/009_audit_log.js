exports.up = async function (knex) {
  await knex.schema.createTable("audit_log", (table) => {
    table.increments("id").primary();
    table.string("action").notNullable();
    table.string("target_public_key");
    table.text("details");
    table.timestamp("created_at").defaultTo(knex.fn.now());
    table.index("action", "idx_audit_log_action");
    table.index("target_public_key", "idx_audit_log_target_public_key");
    table.index("created_at", "idx_audit_log_created_at");
  });
};
exports.down = function (knex) {
  return knex.schema.dropTableIfExists("audit_log");
};
