"use strict";

const { gql } = require("graphql-tag");

const typeDefs = gql`
  scalar JSON

  type Balance {
    assetCode: String!
    balance: String!
    assetType: String!
  }

  type Account {
    publicKey: String!
    balances: [Balance!]!
    sequence: String!
  }

  type Payment {
    id: String!
    type: String!
    amount: String!
    asset: String!
    from: String!
    to: String!
    memo: String
    createdAt: String!
    transactionHash: String!
  }

  type TopRecipient {
    address: String!
    totalXLMSent: String!
  }

  type DayActivity {
    day: String!
    dayIndex: Int!
    transactionCount: Int!
  }

  type Analytics {
    totalSentXLM: String!
    totalReceivedXLM: String!
    uniqueCounterparties: Int!
    averageTransactionSize: String!
    totalTransactions: Int!
    topRecipients: [TopRecipient!]!
    activityByDay: [DayActivity!]!
  }

  type Tip {
    id: ID!
    senderPublicKey: String!
    creatorPublicKey: String!
    amount: String
    asset: String!
    memo: String!
    txHash: String!
    timestamp: String!
  }

  type TipStats {
    totalTips: Int!
    totalByAsset: JSON!
    averageTip: String
    largestTip: String
    smallestTip: String
  }

  type TipResult {
    tips: [Tip!]!
    stats: TipStats!
    total: Int!
    limit: Int!
    nextCursor: String
  }

  type TurretDeployment {
    id: ID!
    ownerPublicKey: String!
    type: String!
    status: String!
    config: JSON!
    deploymentHash: String!
    createdAt: String!
    nextRunAt: String
    lastExecutedAt: String
    lastError: String
  }

  type Query {
    account(publicKey: String!): Account
    payments(publicKey: String!, limit: Int, cursor: String): [Payment!]!
    analytics(publicKey: String!): Analytics!
    tipsReceived(creatorPublicKey: String!, limit: Int, offset: Int): TipResult!
    turrets(ownerPublicKey: String): [TurretDeployment!]!
  }
`;

module.exports = typeDefs;
