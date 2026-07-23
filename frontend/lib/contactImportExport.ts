/**
 * @file lib/contactImportExport.ts
 * @description CSV and vCard import/export utilities for the Finchippay address book.
 *
 * Implements Issue #36 — Address Book Import/Export (CSV & vCard).
 *
 * No third-party CSV library is used; the parser handles quoted fields, escaped
 * quotes, and Windows-style line endings so it is robust enough for the contact
 * use case without adding a dependency.
 */

import { isValidStellarAddress } from "@/lib/stellar";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal shape of a contact row — maps directly to AddressBookContact fields. */
export interface ContactRow {
  /** Human-readable label for the contact (maps to `nickname`). */
  name: string;
  /** Stellar public key (G…). */
  address: string;
  /** Optional SEP-0002 federation username, e.g. `alice*example.com`. */
  federation?: string;
}

/** Result returned by {@link parseContactsCSV}. */
export interface ParseResult {
  contacts: ContactRow[];
  errors: string[];
}

/** A parsed row annotated with its original 1-based row number and any error. */
export interface AnnotatedRow {
  rowNumber: number;
  contact: ContactRow | null;
  /** Non-empty when this row has a validation or parse problem. */
  error: string;
}

// ─── CSV export ───────────────────────────────────────────────────────────────

/**
 * Escape a CSV cell value: wrap in double-quotes if the value contains a
 * comma, double-quote, or newline, and escape any embedded double-quotes.
 */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serialise an array of contacts to a CSV string.
 *
 * Output format:
 * ```
 * Name,Stellar Address,Federation Username
 * Alice,GABC123...,alice*example.com
 * Bob,GXYZ789...,
 * ```
 *
 * @param contacts - Contacts to export.
 * @returns UTF-8 CSV string with a BOM so Excel opens it correctly.
 */
export function exportContactsCSV(contacts: ContactRow[]): string {
  const header = "Name,Stellar Address,Federation Username";
  const rows = contacts.map((c) =>
    [
      escapeCsvCell(c.name),
      escapeCsvCell(c.address),
      escapeCsvCell(c.federation ?? ""),
    ].join(",")
  );
  // Prepend BOM for correct Excel handling of UTF-8
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

// ─── CSV import ───────────────────────────────────────────────────────────────

/**
 * Tokenise a single CSV line into its field values, respecting quoted fields
 * and escaped double-quotes (RFC 4180).
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i <= line.length) {
    if (i === line.length) {
      // Trailing comma: push empty field
      if (fields.length > 0) fields.push("");
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      let field = "";
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            // Escaped quote
            field += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      // Skip comma after closing quote (if any)
      if (line[i] === ",") i++;
    } else {
      // Unquoted field — read until comma or end of line
      const start = i;
      while (i < line.length && line[i] !== ",") i++;
      fields.push(line.slice(start, i));
      if (line[i] === ",") i++;
    }
  }

  return fields;
}

/**
 * Parse a CSV string into validated {@link ContactRow} objects.
 *
 * Accepts both CRLF and LF line endings and is case-insensitive for the
 * header row, so exports from Excel ("stellar address" vs "Stellar Address")
 * are handled transparently.
 *
 * @param csv - Raw CSV text, with or without a BOM.
 * @returns `{ contacts, errors }` — contacts that passed validation plus a
 *          list of human-readable error strings for rows that failed.
 */
export function parseContactsCSV(csv: string): ParseResult {
  // Strip BOM if present
  const raw = csv.replace(/^\uFEFF/, "").trim();
  if (!raw) return { contacts: [], errors: ["The file is empty."] };

  // Normalise line endings
  const lines = raw.split(/\r\n|\r|\n/);
  if (lines.length < 2) {
    return { contacts: [], errors: ["No data rows found (only a header or empty file)."] };
  }

  // Parse header to find column indices (case-insensitive)
  const headerFields = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = headerFields.findIndex((h) => h === "name");
  const addressIdx = headerFields.findIndex(
    (h) => h === "stellar address" || h === "address"
  );
  const federationIdx = headerFields.findIndex(
    (h) => h === "federation username" || h === "federation"
  );

  if (nameIdx === -1 || addressIdx === -1) {
    return {
      contacts: [],
      errors: [
        `Header row must contain "Name" and "Stellar Address" columns. Found: ${lines[0]}`,
      ],
    };
  }

  const contacts: ContactRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // skip blank lines

    const fields = parseCsvLine(line);
    const rowNum = i + 1; // 1-based, accounting for header

    const name = (fields[nameIdx] ?? "").trim();
    const address = (fields[addressIdx] ?? "").trim();
    const federation =
      federationIdx !== -1 ? (fields[federationIdx] ?? "").trim() : "";

    if (!name && !address) continue; // silently skip completely empty rows

    if (!name) {
      errors.push(`Row ${rowNum}: Name is missing.`);
      continue;
    }

    if (!address) {
      errors.push(`Row ${rowNum}: Stellar address is missing for "${name}".`);
      continue;
    }

    if (!isValidStellarAddress(address)) {
      errors.push(
        `Row ${rowNum}: "${address}" is not a valid Stellar public key (must start with G and be 56 characters).`
      );
      continue;
    }

    contacts.push({
      name,
      address,
      ...(federation ? { federation } : {}),
    });
  }

  return { contacts, errors };
}

/**
 * Parse CSV rows and annotate each with row number and any error, without
 * filtering out invalid rows. Used by the import preview modal to show
 * per-row status with inline error highlighting.
 */
export function parseContactsCSVAnnotated(csv: string): AnnotatedRow[] {
  const raw = csv.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];

  const lines = raw.split(/\r\n|\r|\n/);
  if (lines.length < 2) return [];

  const headerFields = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const nameIdx = headerFields.findIndex((h) => h === "name");
  const addressIdx = headerFields.findIndex(
    (h) => h === "stellar address" || h === "address"
  );
  const federationIdx = headerFields.findIndex(
    (h) => h === "federation username" || h === "federation"
  );

  if (nameIdx === -1 || addressIdx === -1) return [];

  const annotated: AnnotatedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCsvLine(line);
    const rowNum = i + 1;

    const name = (fields[nameIdx] ?? "").trim();
    const address = (fields[addressIdx] ?? "").trim();
    const federation =
      federationIdx !== -1 ? (fields[federationIdx] ?? "").trim() : "";

    if (!name && !address) continue;

    if (!name) {
      annotated.push({ rowNumber: rowNum, contact: null, error: "Name is missing." });
      continue;
    }

    if (!address) {
      annotated.push({
        rowNumber: rowNum,
        contact: null,
        error: `Stellar address is missing for "${name}".`,
      });
      continue;
    }

    if (!isValidStellarAddress(address)) {
      annotated.push({
        rowNumber: rowNum,
        contact: { name, address, ...(federation ? { federation } : {}) },
        error: `"${address}" is not a valid Stellar public key.`,
      });
      continue;
    }

    annotated.push({
      rowNumber: rowNum,
      contact: { name, address, ...(federation ? { federation } : {}) },
      error: "",
    });
  }

  return annotated;
}

// ─── vCard export ─────────────────────────────────────────────────────────────

/** Line break used in vCard files (RFC 6350 §3.2). */
const CRLF = "\r\n";

/**
 * Escape a vCard property value: backslash, comma, semicolon, and newline
 * characters must be escaped per RFC 6350 §4.
 */
function escapeVCardValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r?\n/g, "\\n");
}

/**
 * Generate a vCard 3.0 string for a single contact.
 *
 * The Stellar address is stored in the `NOTE` property so it can be copied
 * from any vCard-compatible app. The optional federation address is stored as
 * an `X-STELLAR-FEDERATION` extension property.
 *
 * @param contact - Contact to export.
 * @returns vCard 3.0 string.
 */
export function exportContactVCard(contact: ContactRow): string {
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escapeVCardValue(contact.name)}`,
    `N:${escapeVCardValue(contact.name)};;;;`,
    `NOTE:Stellar Address: ${escapeVCardValue(contact.address)}`,
    `X-STELLAR-ADDRESS:${escapeVCardValue(contact.address)}`,
  ];

  if (contact.federation) {
    lines.push(`X-STELLAR-FEDERATION:${escapeVCardValue(contact.federation)}`);
  }

  lines.push("END:VCARD");
  return lines.join(CRLF) + CRLF;
}

/**
 * Generate a multi-contact `.vcf` file by concatenating individual vCards.
 *
 * @param contacts - Contacts to export.
 * @returns vCard 3.0 string containing all contacts.
 */
export function exportContactsVCard(contacts: ContactRow[]): string {
  return contacts.map(exportContactVCard).join("");
}

// ─── Download helpers (browser only) ─────────────────────────────────────────

/**
 * Trigger a file download in the browser.
 *
 * Creates a temporary `<a>` element, sets its `href` to an object URL, clicks
 * it, then immediately revokes the URL to free memory.
 *
 * @param content - File content string.
 * @param filename - Suggested file name shown in the save dialog.
 * @param mimeType - MIME type for the blob (e.g. `"text/csv"`).
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  if (typeof window === "undefined") return;

  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke after a short delay to let the browser initiate the download
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

/**
 * Read a {@link File} object as a UTF-8 text string.
 *
 * @param file - The file selected by the user.
 * @returns Promise resolving to the file's text content.
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file, "utf-8");
  });
}
