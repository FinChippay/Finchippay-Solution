/**
 * src/utils/paginate.js
 * Shared helpers for cursor-based (keyset) pagination across all list endpoints (#74).
 *
 * A cursor is an opaque, base64url-encoded JSON object carrying the sort-key
 * values of the last row on a page — e.g. `{ created_at, id }` or
 * `{ ledger_sequence, id }`. Consumers never parse it; they echo the
 * `nextCursor` from one page back as `?cursor=` to fetch the next.
 *
 * Keyset (not offset) is used so that pages stay stable and cheap even as rows
 * are inserted, mirroring Stellar Horizon's `paging_token` model. Every service
 * fetches `limit + 1` rows so the presence of a next page can be detected
 * without a second query; `buildPage` slices the extra row off and derives the
 * cursor from the last row it returns.
 *
 * Usage:
 *   const { buildPage, setPaginationHeaders } = require("../utils/paginate");
 *
 *   const { rows, total } = await service.list(id, { limit, cursor });
 *   const { data, nextCursor } = buildPage(rows, limit, (r) => ({
 *     created_at: r.created_at,
 *     id: r.id,
 *   }));
 *   setPaginationHeaders(req, res, { nextCursor, total, limit });
 *   res.json({ success: true, data, pagination: { nextCursor, total, limit } });
 */

"use strict";

// Reserved query params that describe the page itself — everything else on the
// request (filters, etc.) is preserved when building the `Link` header URL.
const PAGINATION_PARAMS = new Set(["cursor", "limit", "offset"]);

/**
 * Error thrown when a cursor cannot be decoded. Tagged so the pagination
 * middleware can distinguish it and respond with `VAL_INVALID_CURSOR`.
 */
class InvalidCursorError extends Error {
  constructor(message = "Malformed pagination cursor") {
    super(message);
    this.name = "InvalidCursorError";
    this.code = "VAL_INVALID_CURSOR";
  }
}

/**
 * Encode sort-key fields into an opaque cursor string.
 *
 * @param {object} fields - Plain object of the last row's sort-key values.
 * @returns {string} base64url-encoded cursor.
 */
function encodeCursor(fields) {
  return Buffer.from(JSON.stringify(fields), "utf8").toString("base64url");
}

/**
 * Decode an opaque cursor string back into its sort-key fields.
 *
 * @param {string} cursor
 * @returns {object}
 * @throws {InvalidCursorError} when the cursor is not decodable JSON object.
 */
function decodeCursor(cursor) {
  if (typeof cursor !== "string" || cursor.length === 0) {
    throw new InvalidCursorError();
  }
  let parsed;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw new InvalidCursorError();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidCursorError();
  }
  return parsed;
}

/**
 * Turn `limit + 1` fetched rows into a page plus the cursor for the next one.
 *
 * @param {Array<object>} rows - Rows fetched with a `limit + 1` bound.
 * @param {number} limit - The page size that was requested.
 * @param {(row: object) => object} getCursorFields - Extract sort-key fields
 *   from a row for the cursor.
 * @returns {{ data: Array<object>, nextCursor: string | null }}
 */
function buildPage(rows, limit, getCursorFields) {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && data.length > 0 ? encodeCursor(getCursorFields(data[data.length - 1])) : null;
  return { data, nextCursor };
}

/**
 * Apply a keyset (seek) predicate to a Knex query for cursor pagination.
 *
 * `columns` is the ordered sort key, e.g. `[["created_at", "desc"], ["id", "desc"]]`.
 * The cursor object must carry a value for each column name. Builds the
 * lexicographic comparison that returns rows strictly "after" the cursor row in
 * the given sort order:
 *
 *   (a < :a) OR (a = :a AND b < :b) OR ...   // for all-desc keys
 *
 * @param {import('knex').Knex.QueryBuilder} query
 * @param {object | null} cursor
 * @param {Array<[string, "asc" | "desc"]>} columns
 * @returns {import('knex').Knex.QueryBuilder}
 */
function applyKnexKeyset(query, cursor, columns) {
  if (!cursor) return query;
  return query.where(function () {
    for (let i = 0; i < columns.length; i++) {
      this.orWhere(function () {
        for (let j = 0; j < i; j++) {
          this.andWhere(columns[j][0], "=", cursor[columns[j][0]]);
        }
        const op = columns[i][1] === "asc" ? ">" : "<";
        this.andWhere(columns[i][0], op, cursor[columns[i][0]]);
      });
    }
  });
}

/**
 * Cursor-paginate an in-memory array (for endpoints whose service returns the
 * full list, e.g. webhooks/scheduled where a stable service signature is
 * required by callers/tests). Sorts by `compare`, seeks past the cursor row,
 * and slices `limit` items.
 *
 * @param {Array<object>} rows - Full result set.
 * @param {{ limit: number, cursor: object | null }} page
 * @param {(row: object) => object} getCursorFields
 * @param {(a: object, b: object) => number} compare - Sort order (e.g. newest first).
 * @returns {{ data: Array<object>, nextCursor: string | null, total: number }}
 */
function paginateInMemory(rows, { limit, cursor }, getCursorFields, compare) {
  const sorted = [...rows].sort(compare);
  let start = 0;
  if (cursor) {
    const keys = Object.keys(cursor);
    const idx = sorted.findIndex((row) => {
      const fields = getCursorFields(row);
      return keys.every((k) => String(fields[k]) === String(cursor[k]));
    });
    start = idx >= 0 ? idx + 1 : 0;
  }
  const data = sorted.slice(start, start + limit);
  const hasMore = start + limit < sorted.length;
  const nextCursor =
    hasMore && data.length > 0 ? encodeCursor(getCursorFields(data[data.length - 1])) : null;
  return { data, nextCursor, total: rows.length };
}

/**
 * Merge a value into the `Access-Control-Expose-Headers` response header
 * without clobbering values other middleware (e.g. tracing) already set.
 *
 * @param {import('express').Response} res
 * @param {string[]} headerNames
 */
function exposeHeaders(res, headerNames) {
  const existing = res.getHeader("Access-Control-Expose-Headers");
  const current = existing
    ? String(existing)
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean)
    : [];
  const merged = new Set([...current, ...headerNames]);
  res.setHeader("Access-Control-Expose-Headers", [...merged].join(", "));
}

/**
 * Set RFC 5988 `Link` and `X-Total-Count` headers for a paginated response.
 *
 * The `Link` header is emitted only when there is a next page. Its URL reuses
 * the current request path and preserves any non-pagination query params.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ nextCursor: string | null, total: number, limit: number }} page
 */
function setPaginationHeaders(req, res, { nextCursor, total, limit }) {
  if (Number.isFinite(total)) {
    res.setHeader("X-Total-Count", String(total));
  }

  const exposed = ["X-Total-Count"];

  if (nextCursor) {
    const params = new URLSearchParams();
    // Preserve existing filters/params, dropping the old cursor/limit.
    for (const [key, value] of Object.entries(req.query || {})) {
      if (!PAGINATION_PARAMS.has(key) && value !== undefined) {
        params.set(key, Array.isArray(value) ? value[0] : String(value));
      }
    }
    params.set("cursor", nextCursor);
    params.set("limit", String(limit));

    const path = `${req.baseUrl || ""}${req.path || ""}`;
    res.setHeader("Link", `<${path}?${params.toString()}>; rel="next"`);
    exposed.push("Link");
  }

  exposeHeaders(res, exposed);
}

/**
 * Format a standardized cursor-paginated response object (#344).
 *
 * Shape:
 * {
 *   success: true,
 *   data: [...],
 *   pagination: {
 *     nextCursor: string | null,
 *     hasMore: boolean,
 *     total: number | null,
 *     ...extra
 *   }
 * }
 *
 * @param {Array<object>} data - Result items for the current page.
 * @param {string | object | null} cursor - Next cursor or null.
 * @param {number | null} [total] - Total item count if known.
 * @param {object} [extra] - Additional pagination fields (e.g. limit, offset).
 * @returns {{ success: boolean, data: Array<object>, pagination: { nextCursor: string | null, hasMore: boolean, total: number | null } }}
 */
function formatPaginatedResponse(data, cursor, total, extra = {}) {
  const items = Array.isArray(data) ? data : [];
  let nextCursorStr = null;
  if (cursor) {
    if (typeof cursor === "object") {
      nextCursorStr = encodeCursor(cursor);
    } else if (typeof cursor === "string" && cursor.trim().length > 0) {
      nextCursorStr = cursor.trim();
    }
  }

  const hasMore = items.length > 0 && Boolean(nextCursorStr);

  return {
    success: true,
    data: items,
    pagination: {
      nextCursor: items.length > 0 ? nextCursorStr : null,
      hasMore,
      total: total !== undefined && total !== null ? total : null,
      ...extra,
    },
  };
}

module.exports = {
  InvalidCursorError,
  encodeCursor,
  decodeCursor,
  buildPage,
  applyKnexKeyset,
  paginateInMemory,
  setPaginationHeaders,
  formatPaginatedResponse,
};
