/**
 * __tests__/federation.test.js
 * Integration tests for federation endpoints per SEP-0002.
 */

"use strict";

const request = require("supertest");
const nock = require("nock");
const app = require("../src/server");
const usernameService = require("../src/services/usernameService");

describe("Federation API", () => {
  const testUsername = "testuser";
  const testPublicKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  beforeAll(async () => {
    // Register a test user
    try {
      usernameService.registerUsername(testUsername, testPublicKey);
    } catch (err) {
      // User might already exist
    }
  });

  afterAll(async () => {
    // Clean up
    nock.cleanAll();
    try {
      usernameService.removeUsername(testUsername);
    } catch (err) {
      // User might not exist
    }
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe("GET /.well-known/stellar.toml", () => {
    it("should return valid TOML with FEDERATION_SERVER", async () => {
      const response = await request(app)
        .get("/.well-known/stellar.toml")
        .expect(200)
        .expect("Content-Type", /application\/toml/);

      expect(response.text).toContain("FEDERATION_SERVER=");
      expect(response.text).toContain("/federation");
      expect(response.text).not.toContain("[FEDERATION_SERVER]");
    });
  });

  describe("GET /federation", () => {
    describe("type=name", () => {
      it("should resolve a local stellar address", async () => {
        const stellarAddress = `${testUsername}*stellarfinchippay.io`;

        const response = await request(app)
          .get("/federation")
          .query({ q: stellarAddress, type: "name" })
          .expect(200);

        expect(response.body).toHaveProperty("stellar_address", stellarAddress);
        expect(response.body).toHaveProperty("account_id", testPublicKey);
      });

      it("should resolve configured legacy local domains", async () => {
        const stellarAddress = `${testUsername}*stellarfinchippay.com`;

        const response = await request(app)
          .get("/federation")
          .query({ q: stellarAddress, type: "name" })
          .expect(200);

        expect(response.body).toHaveProperty("stellar_address", stellarAddress);
        expect(response.body).toHaveProperty("account_id", testPublicKey);
      });

      it("should return 404 for non-existent username", async () => {
        const stellarAddress = "nonexistent*stellarfinchippay.io";

        const response = await request(app)
          .get("/federation")
          .query({ q: stellarAddress, type: "name" })
          .expect(404);

        expect(response.body).toHaveProperty("error", "Username not found");
      });

      it("should return 400 for invalid stellar address format", async () => {
        const invalidAddress = "invalidaddress";

        const response = await request(app)
          .get("/federation")
          .query({ q: invalidAddress, type: "name" })
          .expect(400);

        expect(response.body).toHaveProperty("error");
      });

      it("should return 502 when external federation returns invalid account_id", async () => {
        const externalAddress = "someuser*externaldomain.com";

        // Mock stellar.toml fetch
        nock("https://externaldomain.com")
          .get("/.well-known/stellar.toml")
          .reply(200, 'FEDERATION_SERVER="https://fed.externaldomain.com/federation"');

        // Mock federation server returning a malformed account_id
        nock("https://fed.externaldomain.com")
          .get("/federation")
          .query({ q: externalAddress, type: "name" })
          .reply(200, {
            stellar_address: externalAddress,
            account_id: "not-a-valid-stellar-key",
          });

        const response = await request(app)
          .get("/federation")
          .query({ q: externalAddress, type: "name" })
          .expect(502);

        expect(response.body).toHaveProperty(
          "error",
          "Invalid Stellar address returned from federation server"
        );
      });
    });

    describe("type=id", () => {
      it("should resolve a local account ID", async () => {
        const response = await request(app)
          .get("/federation")
          .query({ q: testPublicKey, type: "id" })
          .expect(200);

        expect(response.body).toHaveProperty("stellar_address", `${testUsername}*stellarfinchippay.io`);
        expect(response.body).toHaveProperty("account_id", testPublicKey);
      });

      it("should return 404 for non-existent account ID", async () => {
        const unknownPublicKey = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

        const response = await request(app)
          .get("/federation")
          .query({ q: unknownPublicKey, type: "id" })
          .expect(404);

        expect(response.body).toHaveProperty("error", "Account ID not found");
      });
    });

    it("should return 400 for missing parameters", async () => {
      const response = await request(app)
        .get("/federation")
        .expect(400);

      expect(response.body).toHaveProperty("error", "Missing required parameters: q and type");
    });

    it("should return 400 for invalid type", async () => {
      const response = await request(app)
        .get("/federation")
        .query({ q: "test", type: "invalid" })
        .expect(400);

      expect(response.body).toHaveProperty("error", "Invalid type parameter. Must be 'name' or 'id'");
    });
  });
});
