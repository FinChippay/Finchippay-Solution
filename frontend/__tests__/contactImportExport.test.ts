/**
 * @file __tests__/contactImportExport.test.ts
 * @description Unit tests for frontend/lib/contactImportExport.ts
 *
 * Covers Issue #36 acceptance criteria:
 * - exportContactsCSV produces a valid CSV
 * - parseContactsCSV validates Stellar addresses
 * - parseContactsCSV detects and reports errors
 * - exportContactVCard / exportContactsVCard produce valid vCard strings
 * - parseContactsCSVAnnotated annotates rows with per-row status
 */

import {
  exportContactsCSV,
  parseContactsCSV,
  parseContactsCSVAnnotated,
  exportContactVCard,
  exportContactsVCard,
} from "@/lib/contactImportExport";

// ─── Test data ────────────────────────────────────────────────────────────────

// A syntactically valid Stellar public key (56 chars, starts with G)
const VALID_ADDRESS_1 = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNA";
const VALID_ADDRESS_2 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA7";
const INVALID_ADDRESS = "not-a-stellar-key";
const SHORT_ADDRESS = "GABC123";

const contacts = [
  { name: "Alice", address: VALID_ADDRESS_1, federation: "alice*example.com" },
  { name: "Bob", address: VALID_ADDRESS_2 },
];

// ─── exportContactsCSV ───────────────────────────────────────────────────────

describe("exportContactsCSV", () => {
  it("produces a header row with the three expected columns", () => {
    const csv = exportContactsCSV(contacts);
    // Strip BOM before checking
    const stripped = csv.replace(/^\uFEFF/, "");
    const firstLine = stripped.split(/\r\n/)[0];
    expect(firstLine).toBe("Name,Stellar Address,Federation Username");
  });

  it("includes a BOM prefix for Excel compatibility", () => {
    const csv = exportContactsCSV(contacts);
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });

  it("contains one data row per contact", () => {
    const csv = exportContactsCSV(contacts);
    const lines = csv.replace(/^\uFEFF/, "").split(/\r\n/).filter(Boolean);
    // header + 2 contacts
    expect(lines).toHaveLength(3);
  });

  it("writes the federation address in the third column", () => {
    const csv = exportContactsCSV(contacts);
    const lines = csv.replace(/^\uFEFF/, "").split(/\r\n/);
    expect(lines[1]).toContain("alice*example.com");
  });

  it("leaves the federation column empty when not provided", () => {
    const csv = exportContactsCSV(contacts);
    const lines = csv.replace(/^\uFEFF/, "").split(/\r\n/);
    // Bob row — last field is empty
    expect(lines[2].endsWith(",")).toBe(true);
  });

  it("handles an empty contact list", () => {
    const csv = exportContactsCSV([]);
    const lines = csv.replace(/^\uFEFF/, "").split(/\r\n/).filter(Boolean);
    expect(lines).toHaveLength(1); // header only
  });

  it("escapes commas in names by wrapping in double-quotes", () => {
    const csv = exportContactsCSV([
      { name: "Smith, John", address: VALID_ADDRESS_1 },
    ]);
    expect(csv).toContain('"Smith, John"');
  });

  it("escapes double-quotes by doubling them", () => {
    const csv = exportContactsCSV([
      { name: 'Say "Hi"', address: VALID_ADDRESS_1 },
    ]);
    expect(csv).toContain('"Say ""Hi"""');
  });
});

// ─── parseContactsCSV ────────────────────────────────────────────────────────

describe("parseContactsCSV", () => {
  it("parses a well-formed CSV produced by exportContactsCSV", () => {
    const csv = exportContactsCSV(contacts);
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(errors).toHaveLength(0);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("Alice");
    expect(parsed[0].address).toBe(VALID_ADDRESS_1);
    expect(parsed[0].federation).toBe("alice*example.com");
    expect(parsed[1].name).toBe("Bob");
    expect(parsed[1].address).toBe(VALID_ADDRESS_2);
    expect(parsed[1].federation).toBeUndefined();
  });

  it("accepts LF-only line endings", () => {
    const csv = "Name,Stellar Address,Federation Username\n" +
      `Alice,${VALID_ADDRESS_1},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(errors).toHaveLength(0);
    expect(parsed).toHaveLength(1);
  });

  it("returns an error when the file is empty", () => {
    const { contacts: parsed, errors } = parseContactsCSV("");
    expect(parsed).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns an error when no data rows are present", () => {
    const { contacts: parsed, errors } = parseContactsCSV(
      "Name,Stellar Address,Federation Username"
    );
    expect(parsed).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("flags an invalid Stellar address with an error", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Bad Actor,${INVALID_ADDRESS},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(parsed).toHaveLength(0);
    expect(errors[0]).toMatch(/not a valid Stellar public key/i);
  });

  it("flags a too-short Stellar address", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Short,${SHORT_ADDRESS},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(parsed).toHaveLength(0);
    expect(errors[0]).toMatch(/not a valid Stellar public key/i);
  });

  it("flags a missing name with an error", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `,${VALID_ADDRESS_1},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(parsed).toHaveLength(0);
    expect(errors[0]).toMatch(/name is missing/i);
  });

  it("flags a missing address with an error", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      "Alice,,";
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(parsed).toHaveLength(0);
    expect(errors[0]).toMatch(/stellar address is missing/i);
  });

  it("accepts a header using just 'Address' instead of 'Stellar Address'", () => {
    const csv =
      "Name,Address\n" +
      `Alice,${VALID_ADDRESS_1}`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(errors).toHaveLength(0);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].address).toBe(VALID_ADDRESS_1);
  });

  it("returns mixed results: some valid contacts and some errors", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Alice,${VALID_ADDRESS_1},\n` +
      `Bad Actor,${INVALID_ADDRESS},\n` +
      `Bob,${VALID_ADDRESS_2},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(parsed).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });

  it("returns an error when the header is missing required columns", () => {
    const csv = "FirstName,StellarKey\nAlice," + VALID_ADDRESS_1;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(parsed).toHaveLength(0);
    expect(errors[0]).toMatch(/header row must contain/i);
  });

  it("handles quoted fields with embedded commas", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `"Smith, John",${VALID_ADDRESS_1},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(errors).toHaveLength(0);
    expect(parsed[0].name).toBe("Smith, John");
  });

  it("strips BOM from the input before parsing", () => {
    const csv = "\uFEFFName,Stellar Address,Federation Username\n" +
      `Alice,${VALID_ADDRESS_1},`;
    const { contacts: parsed, errors } = parseContactsCSV(csv);
    expect(errors).toHaveLength(0);
    expect(parsed).toHaveLength(1);
  });
});

// ─── parseContactsCSVAnnotated ───────────────────────────────────────────────

describe("parseContactsCSVAnnotated", () => {
  it("returns annotated rows for every non-blank data line", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Alice,${VALID_ADDRESS_1},\n` +
      `Bad,${INVALID_ADDRESS},`;
    const rows = parseContactsCSVAnnotated(csv);
    expect(rows).toHaveLength(2);
  });

  it("sets error to empty string for valid rows", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Alice,${VALID_ADDRESS_1},`;
    const rows = parseContactsCSVAnnotated(csv);
    expect(rows[0].error).toBe("");
    expect(rows[0].contact).not.toBeNull();
  });

  it("sets error message for rows with invalid addresses", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Bad,${INVALID_ADDRESS},`;
    const rows = parseContactsCSVAnnotated(csv);
    expect(rows[0].error).toMatch(/not a valid Stellar public key/i);
  });

  it("attaches the correct 1-based rowNumber to each row", () => {
    const csv =
      "Name,Stellar Address,Federation Username\n" +
      `Alice,${VALID_ADDRESS_1},\n` +
      `Bob,${VALID_ADDRESS_2},`;
    const rows = parseContactsCSVAnnotated(csv);
    // Row 2 is the first data row (header is row 1)
    expect(rows[0].rowNumber).toBe(2);
    expect(rows[1].rowNumber).toBe(3);
  });

  it("returns an empty array for an empty CSV", () => {
    expect(parseContactsCSVAnnotated("")).toHaveLength(0);
  });
});

// ─── exportContactVCard ──────────────────────────────────────────────────────

describe("exportContactVCard", () => {
  const contact = { name: "Alice", address: VALID_ADDRESS_1, federation: "alice*example.com" };
  const vcard = exportContactVCard(contact);

  it("starts with BEGIN:VCARD", () => {
    expect(vcard.startsWith("BEGIN:VCARD")).toBe(true);
  });

  it("ends with END:VCARD followed by CRLF", () => {
    expect(vcard.endsWith("END:VCARD\r\n")).toBe(true);
  });

  it("includes VERSION:3.0", () => {
    expect(vcard).toContain("VERSION:3.0");
  });

  it("includes the contact name in FN and N properties", () => {
    expect(vcard).toContain("FN:Alice");
    expect(vcard).toContain("N:Alice;;;;");
  });

  it("includes the Stellar address in NOTE and X-STELLAR-ADDRESS", () => {
    expect(vcard).toContain(`NOTE:Stellar Address: ${VALID_ADDRESS_1}`);
    expect(vcard).toContain(`X-STELLAR-ADDRESS:${VALID_ADDRESS_1}`);
  });

  it("includes the federation address in X-STELLAR-FEDERATION", () => {
    expect(vcard).toContain("X-STELLAR-FEDERATION:alice*example.com");
  });

  it("omits X-STELLAR-FEDERATION when federation is not provided", () => {
    const noFed = exportContactVCard({ name: "Bob", address: VALID_ADDRESS_2 });
    expect(noFed).not.toContain("X-STELLAR-FEDERATION");
  });

  it("escapes backslashes in name", () => {
    const vc = exportContactVCard({ name: "Back\\slash", address: VALID_ADDRESS_1 });
    expect(vc).toContain("FN:Back\\\\slash");
  });

  it("escapes semicolons in name", () => {
    const vc = exportContactVCard({ name: "Semi;colon", address: VALID_ADDRESS_1 });
    expect(vc).toContain("FN:Semi\\;colon");
  });
});

// ─── exportContactsVCard ─────────────────────────────────────────────────────

describe("exportContactsVCard", () => {
  it("concatenates individual vCards", () => {
    const vcf = exportContactsVCard(contacts);
    const beginCount = (vcf.match(/BEGIN:VCARD/g) || []).length;
    expect(beginCount).toBe(contacts.length);
  });

  it("produces an empty string for an empty array", () => {
    expect(exportContactsVCard([])).toBe("");
  });

  it("contains addresses for all contacts", () => {
    const vcf = exportContactsVCard(contacts);
    expect(vcf).toContain(VALID_ADDRESS_1);
    expect(vcf).toContain(VALID_ADDRESS_2);
  });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe("CSV round-trip (export → import)", () => {
  it("faithfully preserves all contacts through a full export → import cycle", () => {
    const original = [
      { name: "Alice Foo", address: VALID_ADDRESS_1, federation: "alice*stellar.org" },
      { name: "Bob Bar", address: VALID_ADDRESS_2 },
    ];

    const csv = exportContactsCSV(original);
    const { contacts: parsed, errors } = parseContactsCSV(csv);

    expect(errors).toHaveLength(0);
    expect(parsed).toHaveLength(original.length);

    for (let i = 0; i < original.length; i++) {
      expect(parsed[i].name).toBe(original[i].name);
      expect(parsed[i].address).toBe(original[i].address);
      if (original[i].federation) {
        expect(parsed[i].federation).toBe(original[i].federation);
      }
    }
  });
});
