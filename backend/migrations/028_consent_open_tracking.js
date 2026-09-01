exports.up = function (knex) {
  return knex.schema.table("notification_email_preferences", (table) => {
    table.boolean("consent_open_tracking").notNullable().defaultTo(false);
  });
};

exports.down = function (knex) {
  return knex.schema.table("notification_email_preferences", (table) => {
    table.dropColumn("consent_open_tracking");
  });
};
