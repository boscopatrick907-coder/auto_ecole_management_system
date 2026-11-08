import { ApiError } from '../utils/validation.js';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (
    !accountId ||
    !accessKeyId ||
    !secretAccessKey ||
    accountId.startsWith('replace-')
  ) {
    return null;
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

export async function createResourceDownloadUrl(storagePath: string): Promise<string> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME || 'la-marseillaise-resources';
  const ttl = Number(process.env.R2_SIGNED_URL_TTL_SECONDS || 3600);

  if (!client) {
    if(process.env.NODE_ENV==='production') throw new ApiError(503,'RESOURCE_STORAGE_UNAVAILABLE','Stockage des cours non configuré.');
    // Local / Demo fallback serving built-in offline-capable PDF/video stream endpoint
    const baseUrl = process.env.PUBLIC_API_BASE_URL || '/api';
    return `${baseUrl}/student/resources/file/${encodeURIComponent(storagePath)}`;
  }

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storagePath,
  });

  return getSignedUrl(client, command, { expiresIn: ttl });
}

export async function createResourceUploadUrl(
  storagePath: string,
  contentType: string
): Promise<string | null> {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME || 'la-marseillaise-resources';

  if (!client) {
    return null;
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storagePath,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn: 900 });
}
