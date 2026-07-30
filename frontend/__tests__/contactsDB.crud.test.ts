import "fake-indexeddb/auto";
import {
  addContact,
  getAllContacts,
  updateContact,
  deleteContact,
  clearAllContacts,
  searchContacts,
  createGroup,
  addToGroup,
  getContactsByGroup,
  deleteGroup,
} from "@/lib/contactsDB";

const VALID_PK = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
const OTHER_PK = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7";

beforeEach(async () => {
  await clearAllContacts();
});

describe("contactsDB CRUD", () => {
  it("adds and lists contacts sorted by name", async () => {
    await addContact({ name: "Bob", publicKey: OTHER_PK });
    await addContact({ name: "Alice", publicKey: VALID_PK });

    const all = await getAllContacts();
    expect(all.map((c) => c.name)).toEqual(["Alice", "Bob"]);
  });

  it("updates a contact's fields", async () => {
    const id = await addContact({ name: "Alice", publicKey: VALID_PK });
    await updateContact(id, { name: "Alicia", memo: "roommate" });

    const [contact] = await getAllContacts();
    expect(contact.name).toBe("Alicia");
    expect(contact.memo).toBe("roommate");
  });

  it("deletes a contact", async () => {
    const id = await addContact({ name: "Alice", publicKey: VALID_PK });
    await deleteContact(id);

    expect(await getAllContacts()).toHaveLength(0);
  });

  it("searches contacts by name, address, or federation address", async () => {
    await addContact({ name: "Alice", publicKey: VALID_PK, federationAddress: "alice*example.com" });
    await addContact({ name: "Bob", publicKey: OTHER_PK });

    expect((await searchContacts("alice")).map((c) => c.name)).toEqual(["Alice"]);
    expect((await searchContacts(OTHER_PK.toLowerCase())).map((c) => c.name)).toEqual(["Bob"]);
    expect((await searchContacts("example.com")).map((c) => c.name)).toEqual(["Alice"]);
  });

  it("clearAllContacts removes every contact", async () => {
    await addContact({ name: "Alice", publicKey: VALID_PK });
    await addContact({ name: "Bob", publicKey: OTHER_PK });

    await clearAllContacts();

    expect(await getAllContacts()).toHaveLength(0);
  });
});

describe("contactsDB group operations", () => {
  it("assigns a contact to a group and reads it back by group", async () => {
    const contactId = await addContact({ name: "Alice", publicKey: VALID_PK });
    const groupId = await createGroup({ name: "Roommates", color: "#000000", icon: "users" });

    await addToGroup(contactId, groupId);

    const contactsInGroup = await getContactsByGroup(groupId);
    expect(contactsInGroup.map((c) => c.name)).toEqual(["Alice"]);
  });

  it("removes the group reference from contacts when a group is deleted", async () => {
    const contactId = await addContact({ name: "Alice", publicKey: VALID_PK });
    const groupId = await createGroup({ name: "Neighbors", color: "#000000", icon: "users" });
    await addToGroup(contactId, groupId);

    await deleteGroup(groupId);

    const [contact] = await getAllContacts();
    expect(contact.groupIds ?? []).not.toContain(groupId);
  });
});
