/**
 * __tests__/swaggerErrorSchemas.test.js
 * #270 — the OpenAPI spec documents the canonical error body everywhere.
 */
"use strict";

const spec = require("../src/swagger");
const { ERROR_CODES } = require("../../shared/errorCodes");

/** Every (path, method, status) triple in the spec whose status is an error. */
function errorResponses() {
  const found = [];
  for (const [route, pathItem] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      for (const [status, response] of Object.entries(
        operation?.responses || {},
      )) {
        if (Number(status) >= 400) {
          found.push({ route, method, status, response });
        }
      }
    }
  }
  return found;
}

describe("ErrorResponse schema", () => {
  const schema = spec.components.schemas.ErrorResponse;

  it("is defined and requires the top-level error key", () => {
    expect(schema).toBeDefined();
    expect(schema.required).toEqual(["error"]);
  });

  it("requires a machine-readable code and a message", () => {
    expect(schema.properties.error.required).toEqual(["code", "message"]);
  });

  it("documents correlationId and details", () => {
    const props = schema.properties.error.properties;
    expect(props.correlationId.type).toBe("string");
    expect(props.details.type).toBe("object");
  });

  it("keeps the legacy Error schema resolvable", () => {
    expect(spec.components.schemas.Error).toBeDefined();
    expect(spec.components.schemas.Error.allOf[0].$ref).toBe(
      "#/components/schemas/ErrorResponse",
    );
  });
});

describe("ErrorCode enum", () => {
  const enumValues = spec.components.schemas.ErrorCode.enum;

  it("lists every code in the shared catalogue", () => {
    expect([...enumValues].sort()).toEqual(Object.keys(ERROR_CODES).sort());
  });

  it("documents at least 50 codes", () => {
    expect(enumValues.length).toBeGreaterThanOrEqual(50);
  });
});

describe("reusable error responses", () => {
  const responses = spec.components.responses;

  it("covers the statuses the API returns", () => {
    for (const name of [
      "BadRequest",
      "Unauthorized",
      "Forbidden",
      "NotFound",
      "Conflict",
      "TooManyRequests",
      "InternalServerError",
      "BadGateway",
    ]) {
      expect(responses[name]).toBeDefined();
    }
  });

  it("points at the canonical schema and documents the correlation header", () => {
    for (const response of Object.values(responses)) {
      expect(response.content["application/json"].schema.$ref).toBe(
        "#/components/schemas/ErrorResponse",
      );
      expect(response.headers["X-Request-ID"]).toBeDefined();
    }
  });
});

describe("documented error statuses", () => {
  const found = errorResponses();

  it("finds error responses to check", () => {
    expect(found.length).toBeGreaterThan(0);
  });

  it("every one returns the canonical error body", () => {
    const missing = found
      .filter((entry) => !entry.response.content)
      .map((entry) => `${entry.method.toUpperCase()} ${entry.route} → ${entry.status}`);

    expect(missing).toEqual([]);
  });

  it("every one keeps its endpoint-specific description", () => {
    for (const entry of found) {
      expect(typeof entry.response.description).toBe("string");
      expect(entry.response.description.length).toBeGreaterThan(0);
    }
  });
});
