const request = require("supertest");
const express = require("express");

// Mock middlewares before requiring the route
jest.mock("../src/middleware/rateLimit", () => ({
  strictLimiter: (req, res, next) => next(),
}));
jest.mock("../src/middleware/userRateLimit", () => ({
  userLimiter: (req, res, next) => next(),
}));
jest.mock("../src/middleware/sanitization", () => ({
  sanitizePublicKey: (req, res, next) => next(),
}));

jest.mock("@stellar/stellar-sdk", () => ({
  Horizon: { Server: class {} },
  Keypair: {},
  TransactionBuilder: class {},
}));

// We also need to mock `validate` since it is used in the same route file
jest.mock("../src/validation/middleware", () => ({
  validate: () => (req, res, next) => next(),
}));

let app;

describe("POST /api/payments/batch/upload", () => {
  beforeAll(() => {
    app = express();
    app.use(express.json());
    
    const paymentsRouter = require("../src/routes/payments");
    app.use("/api/payments", paymentsRouter);
    app.use((err, req, res, next) => {
      console.error("Test app caught error:", err);
      res.status(500).json({ error: err.message });
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it("sanitizes the filename containing malicious characters", async () => {
    const csvContent = "recipient,amount,asset\nGA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA,100,XLM\n";
    
    const res = await request(app)
      .post("/api/payments/batch/upload")
      .attach("csvFile", Buffer.from(csvContent), { filename: 'foo<script>bar?baz|qux.csv' });

    expect(res.status).toBe(200);
    expect(res.body.fileName).not.toContain("<script>");
    expect(res.body.fileName).toBe("fooscriptbarbazqux.csv");
  });

  it("returns 400 with row-level errors for missing recipient", async () => {
    const csvContent = "recipient,amount,asset\n,100,XLM\n"; 
    
    const res = await request(app)
      .post("/api/payments/batch/upload")
      .attach("csvFile", Buffer.from(csvContent), "test.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_JSON");
    expect(res.body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, error: "Missing recipient/to column" })
      ])
    );
  });

  it("returns 400 with row-level errors for non-numeric amount", async () => {
    const csvContent = "recipient,amount,asset\nGA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA,abc,XLM\n"; 
    
    const res = await request(app)
      .post("/api/payments/batch/upload")
      .attach("csvFile", Buffer.from(csvContent), "test.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_JSON");
    expect(res.body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, error: "Invalid or missing amount" })
      ])
    );
  });

  it("returns 400 with row-level errors for missing asset", async () => {
    const csvContent = "recipient,amount,asset\nGA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA,10,\n"; 
    
    const res = await request(app)
      .post("/api/payments/batch/upload")
      .attach("csvFile", Buffer.from(csvContent), "test.csv");

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VAL_INVALID_JSON");
    expect(res.body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, error: "Missing asset column" })
      ])
    );
  });

  it("accepts a valid CSV file and returns 200", async () => {
    const csvContent = "recipient,amount,asset\nGA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA,50.5,USDC\n"; 
    
    const res = await request(app)
      .post("/api/payments/batch/upload")
      .attach("csvFile", Buffer.from(csvContent), "test.csv");

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].recipient).toBe("GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUWDA");
    expect(res.body.rows[0].amount).toBe("50.5");
    expect(res.body.rows[0].asset).toBe("USDC");
  });
});
