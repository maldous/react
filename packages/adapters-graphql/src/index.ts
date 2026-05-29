import { buildBaseTypeDefs } from "@platform/contracts-graphql";
import {
  buildExecutableSchema,
  executeOperation,
  type ResolverMap,
  type OperationInput,
  type OperationResult,
} from "@platform/graphql-api-runtime";
import type { GraphQLSchema } from "graphql";

export const packageName = "@platform/adapters-graphql";

export function createPlatformGraphQLSchema(resolvers: ResolverMap): GraphQLSchema {
  return buildExecutableSchema({ typeDefs: buildBaseTypeDefs(), resolvers });
}

export class GraphQLAdapter {
  private readonly schema: GraphQLSchema;

  constructor(resolvers: ResolverMap) {
    this.schema = createPlatformGraphQLSchema(resolvers);
  }

  async execute<T = Record<string, unknown>>(
    operation: OperationInput
  ): Promise<OperationResult<T>> {
    return executeOperation<T>(this.schema, operation);
  }
}
