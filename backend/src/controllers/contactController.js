/**
 * src/controllers/contactController.js
 * Handles contact sync API requests.
 */

"use strict";

const db = require("../db/connection");

/**
 * GET /contacts/:publicKey
 * Fetch all contacts and groups for the given public key.
 * Returns contacts with their group memberships and all groups.
 */
async function getContacts(req, res, next) {
  try {
    const { publicKey } = req.params;

    const groups = await db("contact_groups")
      .where({ public_key: publicKey })
      .orderBy("name", "asc");

    const contacts = await db("contacts").where({ public_key: publicKey }).orderBy("name", "asc");

    const groupMembership = await db("contact_group_membership")
      .join("contacts", "contact_group_membership.contact_id", "contacts.id")
      .join("contact_groups", "contact_group_membership.group_id", "contact_groups.id")
      .where("contacts.public_key", publicKey)
      .select("contact_group_membership.contact_id", "contact_group_membership.group_id");

    const membershipMap = {};
    for (const row of groupMembership) {
      if (!membershipMap[row.contact_id]) membershipMap[row.contact_id] = [];
      membershipMap[row.contact_id].push(row.group_id);
    }

    const contactsWithGroups = contacts.map((c) => ({
      ...c,
      groups: membershipMap[c.id] || [],
    }));

    return res.json({ contacts: contactsWithGroups, groups });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /contacts/:publicKey/sync
 * Bulk upsert contacts and groups.
 *
 * Body: { groups: Group[], contacts: Contact[] }
 * - Groups are upserted by name.
 * - Contacts are upserted by stellar_address.
 * - Group membership is re-synced after contacts/groups are saved.
 */
async function syncContacts(req, res, next) {
  try {
    const { publicKey } = req.params;
    const { groups = [], contacts = [] } = req.validated;

    const upsertedGroupIds = {};

    // Upsert groups
    for (const group of groups) {
      const existing = await db("contact_groups")
        .where({ public_key: publicKey, name: group.name })
        .first();

      let groupId;
      if (existing) {
        await db("contact_groups")
          .where({ id: existing.id })
          .update({ color: group.color, icon: group.icon });
        groupId = existing.id;
      } else {
        const [inserted] = await db("contact_groups")
          .insert({
            public_key: publicKey,
            name: group.name,
            color: group.color || "#6366f1",
            icon: group.icon || "users",
          })
          .returning("id");
        groupId = inserted.id || inserted;
      }
      upsertedGroupIds[group.name] = groupId;
    }

    // Upsert contacts
    for (const contact of contacts) {
      const existing = await db("contacts")
        .where({ public_key: publicKey, stellar_address: contact.stellar_address })
        .first();

      let contactId;
      if (existing) {
        await db("contacts")
          .where({ id: existing.id })
          .update({
            name: contact.name,
            federation_address: contact.federation_address || null,
            memo: contact.memo || null,
            tags: contact.tags || [],
            updated_at: db.fn.now(),
          });
        contactId = existing.id;
      } else {
        const [inserted] = await db("contacts")
          .insert({
            public_key: publicKey,
            name: contact.name,
            stellar_address: contact.stellar_address,
            federation_address: contact.federation_address || null,
            memo: contact.memo || null,
            tags: contact.tags || [],
          })
          .returning("id");
        contactId = inserted.id || inserted;
      }

      // Re-sync group membership for this contact
      if (contact.groups) {
        await db("contact_group_membership").where({ contact_id: contactId }).del();

        for (const groupName of contact.groups) {
          const gId = upsertedGroupIds[groupName];
          if (gId) {
            await db("contact_group_membership").insert({ contact_id: contactId, group_id: gId });
          }
        }
      }
    }

    // Fetch updated state
    const updatedContacts = await db("contacts")
      .where({ public_key: publicKey })
      .orderBy("name", "asc");

    const membershipRows = await db("contact_group_membership")
      .join("contacts", "contact_group_membership.contact_id", "contacts.id")
      .where("contacts.public_key", publicKey)
      .select("contact_group_membership.contact_id", "contact_group_membership.group_id");

    const membershipMap = {};
    for (const row of membershipRows) {
      if (!membershipMap[row.contact_id]) membershipMap[row.contact_id] = [];
      membershipMap[row.contact_id].push(row.group_id);
    }

    const updatedGroups = await db("contact_groups")
      .where({ public_key: publicKey })
      .orderBy("name", "asc");

    const contactsWithGroups = updatedContacts.map((c) => ({
      ...c,
      groups: membershipMap[c.id] || [],
    }));

    return res.json({ contacts: contactsWithGroups, groups: updatedGroups });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getContacts,
  syncContacts,
};
