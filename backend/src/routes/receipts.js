"use strict";

const express = require("express");
const router = express.Router();
const { validate } = require("../validation/middleware");
const { ipfsUploadSchema, ipfsFetchSchema, mintWithIpfsSchema } = require("../validation/schemas");
const ipfsService = require("../services/ipfsService");

router.post("/ipfs", validate(ipfsUploadSchema), async (req, res, next) => {
  try {
    const result = await ipfsService.uploadMetadata(req.validated.metadata);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.get("/ipfs/:cid", validate(ipfsFetchSchema, "params"), async (req, res, next) => {
  try {
    const content = await ipfsService.fetchMetadata(req.validated.cid);
    res.json({ success: true, data: content });
  } catch (err) {
    next(err);
  }
});

router.post("/mint-with-ipfs", validate(mintWithIpfsSchema), async (req, res, next) => {
  try {
    const result = await ipfsService.mintWithIpfs(req.validated);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
