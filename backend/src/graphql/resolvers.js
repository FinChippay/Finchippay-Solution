"use strict";

const { GraphQLScalarType, Kind } = require("graphql");

const stellarService = require("../services/stellarService");
const analyticsService = require("../services/analyticsService");
const tipsService = require("../services/tipsService");
const turretsService = require("../services/turretsService");

const GraphQLJSON = new GraphQLScalarType({
  name: "JSON",
  serialize(v) {
    if (typeof v === "object" && v !== null) {
      return JSON.parse(JSON.stringify(v));
    }
    return v;
  },
  parseValue(v) {
    return v;
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
        return ast.value;
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
        return parseInt(ast.value, 10);
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.OBJECT: {
        const value = Object.create(null);
        ast.fields.forEach((field) => {
          value[field.name.value] = GraphQLJSON.parseLiteral(field.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map((v) => GraphQLJSON.parseLiteral(v));
      default:
        return null;
    }
  },
});

const resolvers = {
  JSON: GraphQLJSON,

  Query: {
    account(_, { publicKey }) {
      return stellarService.getAccount(publicKey);
    },

    payments(_, { publicKey, limit = 20, cursor }) {
      return stellarService.getPayments(publicKey, { limit, cursor });
    },

    async analytics(_, { publicKey }) {
      const [summary, topRecipientsData, activityData] = await Promise.all([
        analyticsService.getSummary(publicKey),
        analyticsService.getTopRecipients(publicKey),
        analyticsService.getActivityByDay(publicKey),
      ]);

      return {
        ...summary,
        topRecipients: topRecipientsData.topRecipients,
        activityByDay: activityData.activityByDay,
      };
    },

    async tipsReceived(_, { creatorPublicKey, limit = 20 }) {
      const { tips, total } = await tipsService.getTipsReceived(creatorPublicKey, { limit });
      const stats = await tipsService.getTipsStats(creatorPublicKey);

      return {
        tips,
        stats,
        total,
        limit,
        nextCursor: null,
      };
    },

    turrets(_, { ownerPublicKey }) {
      return turretsService.listDeployments(ownerPublicKey);
    },
  },
};

module.exports = resolvers;
