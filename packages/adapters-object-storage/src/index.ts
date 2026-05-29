import {
  S3Client,
  PutObjectCommand as S3PutCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  StorageError,
  type ObjectStoragePort,
  type PutObjectCommand,
  type GetObjectResult,
  type PresignedUrlOptions,
} from "@platform/storage-runtime";

export const packageName = "@platform/adapters-object-storage";

export interface S3Config {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config, client?: S3Client) {
    this.bucket = config.bucket;
    this.client =
      client ??
      new S3Client({
        region: config.region,
        endpoint: config.endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials: config.credentials,
      });
  }

  async put(command: PutObjectCommand): Promise<void> {
    try {
      await this.client.send(
        new S3PutCommand({
          Bucket: this.bucket,
          Key: command.key,
          Body: command.body as Blob,
          ContentType: command.contentType,
          Metadata: command.metadata,
        })
      );
    } catch (err) {
      throw new StorageError(`Failed to put object "${command.key}"`, err);
    }
  }

  async get(key: string): Promise<GetObjectResult | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      if (!response.Body) return null;
      return {
        body: response.Body as unknown as ReadableStream,
        contentType: response.ContentType ?? "application/octet-stream",
        metadata: response.Metadata ?? {},
        size: response.ContentLength ?? 0,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NoSuchKey") return null;
      throw new StorageError(`Failed to get object "${key}"`, err);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      throw new StorageError(`Failed to delete object "${key}"`, err);
    }
  }

  async getPresignedUrl(options: PresignedUrlOptions): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: options.key }),
        { expiresIn: options.expiresInSeconds }
      );
    } catch (err) {
      throw new StorageError(`Failed to get presigned URL for "${options.key}"`, err);
    }
  }

  async list(prefix = ""): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    try {
      const response = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix })
      );
      return (response.Contents ?? []).map((obj) => ({
        key: obj.Key ?? "",
        size: obj.Size ?? 0,
        lastModified: obj.LastModified ?? new Date(),
      }));
    } catch (err) {
      throw new StorageError(`Failed to list objects with prefix "${prefix}"`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// S3ProvisioningAdapter — creates per-tenant IAM users and bucket policies
// ADR-0031: used only by the provisioning path, never in request handlers.
// Requires admin-level S3/IAM credentials stored in the secret store.
// ---------------------------------------------------------------------------

import {
  IAMClient,
  CreateUserCommand,
  DeleteUserCommand,
  PutUserPolicyCommand,
  DeleteUserPolicyCommand,
  CreateAccessKeyCommand,
} from "@aws-sdk/client-iam";

export interface S3AdminConfig {
  region: string;
  bucket: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  credentials: { accessKeyId: string; secretAccessKey: string };
}

export interface TenantS3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  keyPrefix: string;
}

export class S3ProvisioningAdapter {
  private readonly iamClient: IAMClient;
  private readonly bucket: string;

  constructor(config: S3AdminConfig) {
    this.bucket = config.bucket;
    this.iamClient = new IAMClient({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.credentials,
    });
  }

  async createTenantUser(organisationId: string): Promise<TenantS3Credentials> {
    const username = `tenant-${organisationId}`;
    const keyPrefix = `${organisationId}/`;

    // Create IAM user
    await this.iamClient.send(new CreateUserCommand({ UserName: username }));

    // Attach inline policy scoped to tenant prefix
    const policy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
          Resource: [`arn:aws:s3:::${this.bucket}/${keyPrefix}*`, `arn:aws:s3:::${this.bucket}`],
          Condition: { StringLike: { "s3:prefix": `${keyPrefix}*` } },
        },
      ],
    });

    await this.iamClient.send(
      new PutUserPolicyCommand({
        UserName: username,
        PolicyName: `tenant-${organisationId}-access`,
        PolicyDocument: policy,
      })
    );

    // Create access key for the tenant user
    const keyResult = await this.iamClient.send(new CreateAccessKeyCommand({ UserName: username }));
    return {
      accessKeyId: keyResult.AccessKey?.AccessKeyId ?? "",
      secretAccessKey: keyResult.AccessKey?.SecretAccessKey ?? "",
      keyPrefix,
    };
  }

  async revokeTenantUser(organisationId: string): Promise<void> {
    const username = `tenant-${organisationId}`;
    await this.iamClient
      .send(
        new DeleteUserPolicyCommand({
          UserName: username,
          PolicyName: `tenant-${organisationId}-access`,
        })
      )
      .catch(() => undefined);
    await this.iamClient.send(new DeleteUserCommand({ UserName: username })).catch(() => undefined);
  }
}
