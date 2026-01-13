import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

export class S3Service {
  private s3Client: S3Client | null;
  private bucketName: string;
  private isConfigured: boolean;

  constructor() {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const bucket = process.env.AWS_S3_BUCKET;

    // Check if all required AWS credentials are present
    if (!region || !accessKeyId || !secretAccessKey || !bucket) {
      console.warn('[S3Service] AWS credentials not configured. File uploads will fail.');
      console.warn('[S3Service] Required environment variables: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET');
      this.s3Client = null;
      this.bucketName = bucket || '';
      this.isConfigured = false;
    } else {
      this.s3Client = new S3Client({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey
        }
      });
      this.bucketName = bucket;
      this.isConfigured = true;
    }
  }

  async uploadFile(file: Buffer, originalFilename: string, mimeType: string, folder: string = 'knowledge-base'): Promise<string> {
    if (!this.isConfigured || !this.s3Client) {
      throw new Error('AWS S3 is not configured. Please set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET environment variables.');
    }

    const fileExtension = originalFilename.split('.').pop();
    const filename = `${uuidv4()}.${fileExtension}`;
    const key = `${folder}/${filename}`;

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: file,
      ContentType: mimeType
    });

    await this.s3Client.send(command);

    const region = process.env.AWS_REGION!;
    return `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;
  }

  async deleteFile(url: string): Promise<void> {
    if (!this.isConfigured || !this.s3Client) {
      throw new Error('AWS S3 is not configured. Please set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET environment variables.');
    }

    const key = url.split('.com/')[1];

    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    await this.s3Client.send(command);
  }

  async getSignedUrl(url: string, expiresIn = 3600): Promise<string> {
    if (!this.isConfigured || !this.s3Client) {
      throw new Error('AWS S3 is not configured. Please set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_S3_BUCKET environment variables.');
    }

    const key = url.split('.com/')[1];

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }
}

export const s3Service = new S3Service();

