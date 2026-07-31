import {
  generateCSV,
  generateVCard,
  parseCSV,
  parseVCard,
  type Contact,
  type ContactGroup,
} from "@/lib/contactsDB";

const VALID_PK = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";

const sampleContact: Contact = {
  id: 1,
  name: "Alice",
  publicKey: VALID_PK,
  groupIds: [1, 2],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const sampleGroups: ContactGroup[] = [
  { id: 1, name: "Favorites", color: "#f59e0b", icon: "star", createdAt: Date.now() },
  { id: 2, name: "Work", color: "#6366f1", icon: "briefcase", createdAt: Date.now() },
];

describe("generateCSV", () => {
  it("includes group names when groups are provided", () => {
    const csv = generateCSV([sampleContact], sampleGroups);
    expect(csv).toContain("Favorites");
    expect(csv).toContain("Work");
  });

  it("omits group column when no groups provided", () => {
    const csv = generateCSV([sampleContact]);
    expect(csv).toContain("name,publicKey,memo,federationAddress,groups");
  });

  it("handles contacts with no groupIds", () => {
    const noGroupContact = { ...sampleContact, groupIds: undefined };
    const csv = generateCSV([noGroupContact], sampleGroups);
    expect(csv).toContain(noGroupContact.name);
    expect(csv).toContain(noGroupContact.publicKey);
  });
});

describe("generateVCard", () => {
  it("includes X-STELLAR-GROUPS when groups provided", () => {
    const vcf = generateVCard([sampleContact], sampleGroups);
    expect(vcf).toContain("X-STELLAR-GROUPS:");
    expect(vcf).toContain("Favorites");
    expect(vcf).toContain("Work");
  });

  it("omits X-STELLAR-GROUPS when contact has no groups", () => {
    const noGroupContact = { ...sampleContact, groupIds: [] };
    const vcf = generateVCard([noGroupContact], sampleGroups);
    expect(vcf).not.toContain("X-STELLAR-GROUPS");
  });

  it("outputs multiple vCards concatenated", () => {
    const c2 = { ...sampleContact, id: 2, name: "Bob", publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7" };
    const vcf = generateVCard([sampleContact, c2]);
    const count = (vcf.match(/BEGIN:VCARD/g) || []).length;
    expect(count).toBe(2);
  });
});

describe("parseCSV", () => {
  it("parses CSV with group assignments", () => {
    const csv = "name,publicKey,memo,federationAddress,groups\nAlice,GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA,,,Favorites;Work";
    const contacts = parseCSV(csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Alice");
    expect(contacts[0].tags).toEqual(["Favorites", "Work"]);
  });

  it("parses CSV without group column", () => {
    const csv = "name,publicKey\nAlice,GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
    const contacts = parseCSV(csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].tags).toBeUndefined();
  });

  it("returns empty array when required headers are missing", () => {
    expect(parseCSV("foo,bar\na,b")).toHaveLength(0);
  });
});

describe("parseVCard", () => {
  it("parses vCard with group tags", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nX-STELLAR-ADDRESS:GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA\r\nX-STELLAR-GROUPS:Favorites;Work\r\nEND:VCARD";
    const contacts = parseVCard(vcf);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Alice");
    expect(contacts[0].tags).toEqual(["Favorites", "Work"]);
  });

  it("parses vCard without group tags", () => {
    const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Bob\r\nX-STELLAR-ADDRESS:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7\r\nEND:VCARD";
    const contacts = parseVCard(vcf);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].tags).toBeUndefined();
  });
});
