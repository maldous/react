import {
  buildSchema,
  graphql,
  type GraphQLSchema,
  type GraphQLResolveInfo,
} from "graphql";

export const packageName = "@platform/graphql-api-runtime";

export type Resolver<
  TParent = unknown,
  TArgs = Record<string, unknown>,
  TContext = unknown,
  TReturn = unknown,
> = (parent: TParent, args: TArgs, context: TContext, info: GraphQLResolveInfo) => TReturn | Promise<TReturn>;

export type ResolverMap = Record<string, Record<string, Resolver>>;

export interface ExecutableSchemaInput {
  typeDefs: string;
  resolvers: ResolverMap;
}

export interface OperationInput {
  query: string;
  operationName?: string;
  variables?: Record<string, unknown>;
  context?: unknown;
}

export interface OperationResult<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export function buildExecutableSchema(input: ExecutableSchemaInput): GraphQLSchema {
  const schema = buildSchema(input.typeDefs);
  for (const [typeName, fields] of Object.entries(input.resolvers)) {
    const type = schema.getType(typeName);
    if (type && "getFields" in type) {
      const typeFields = (
        type as { getFields(): Record<string, { resolve?: unknown }> }
      ).getFields();
      for (const [fieldName, resolver] of Object.entries(fields)) {
        if (typeFields[fieldName]) {
          typeFields[fieldName].resolve = resolver;
        }
      }
    }
  }
  return schema;
}

export async function executeOperation<T = Record<string, unknown>>(
  schema: GraphQLSchema,
  operation: OperationInput,
): Promise<OperationResult<T>> {
  const result = await graphql({
    schema,
    source: operation.query,
    operationName: operation.operationName,
    variableValues: operation.variables,
    contextValue: operation.context,
  });
  return result as OperationResult<T>;
}
