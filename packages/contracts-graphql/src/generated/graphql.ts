/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type HealthStatus = {
  __typename?: 'HealthStatus';
  status: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  updateOrganisationProfile?: Maybe<Organisation>;
};


export type MutationUpdateOrganisationProfileArgs = {
  displayName: Scalars['String']['input'];
};

export type Organisation = {
  __typename?: 'Organisation';
  createdAt: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  slug: Scalars['String']['output'];
  updatedAt: Scalars['String']['output'];
};

export type Query = {
  __typename?: 'Query';
  health: HealthStatus;
  organisationProfile?: Maybe<Organisation>;
};

export type OrganisationProfileFieldsFragment = { id: string, slug: string, displayName: string, createdAt: string, updatedAt: string };

export type OrganisationProfileQueryVariables = Exact<{ [key: string]: never; }>;


export type OrganisationProfileQuery = { organisationProfile: { id: string, slug: string, displayName: string, createdAt: string, updatedAt: string } | null };

export type UpdateOrganisationProfileMutationVariables = Exact<{
  displayName: string;
}>;


export type UpdateOrganisationProfileMutation = { updateOrganisationProfile: { id: string, slug: string, displayName: string, createdAt: string, updatedAt: string } | null };

export const OrganisationProfileFieldsFragmentDoc = {"kind":"Document","definitions":[{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrganisationProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Organisation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<OrganisationProfileFieldsFragment, unknown>;
export const OrganisationProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"OrganisationProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"organisationProfile"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrganisationProfileFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrganisationProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Organisation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<OrganisationProfileQuery, OrganisationProfileQueryVariables>;
export const UpdateOrganisationProfileDocument = {"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"UpdateOrganisationProfile"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"displayName"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"updateOrganisationProfile"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"displayName"},"value":{"kind":"Variable","name":{"kind":"Name","value":"displayName"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"FragmentSpread","name":{"kind":"Name","value":"OrganisationProfileFields"}}]}}]}},{"kind":"FragmentDefinition","name":{"kind":"Name","value":"OrganisationProfileFields"},"typeCondition":{"kind":"NamedType","name":{"kind":"Name","value":"Organisation"}},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"displayName"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}},{"kind":"Field","name":{"kind":"Name","value":"updatedAt"}}]}}]} as unknown as DocumentNode<UpdateOrganisationProfileMutation, UpdateOrganisationProfileMutationVariables>;