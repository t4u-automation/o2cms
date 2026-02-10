/**
 * Root GraphQL Resolvers
 * Combines all resolver modules
 */

import { queryResolvers } from "./query";

export const resolvers = {
  ...queryResolvers,
};

