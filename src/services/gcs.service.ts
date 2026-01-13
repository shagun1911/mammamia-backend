import { Storage } from '@google-cloud/storage';
import { v4 as uuidv4 } from 'uuid';

export class GCSService {
  private storage: Storage | null;
  private bucketName: string;
  private isConfigured: boolean;

  constructor() {
    const bucket = process.env.GCS_BUCKET_NAME;
    const gcsKey = process.env.GCS_KEY; // JSON string of service account key

    // Check if GCS is configured
    if (!bucket) {
      console.warn('[GCSService] GCS bucket not configured. File uploads will fail.');
      console.warn('[GCSService] Required environment variable: GCS_BUCKET_NAME');
      this.storage = null;
      this.bucketName = '';
      this.isConfigured = false;
      return;
    }

    this.bucketName = bucket;

    // Initialize GCS client with credentials from environment variable
    try {
      if (gcsKey) {
        // Parse the JSON key from environment variable
        const credentials = JSON.parse(gcsKey);
        this.storage = new Storage({
          projectId: credentials.project_id,
          credentials: {
            client_email: credentials.client_email,
            private_key: credentials.private_key.replace(/\\n/g, '\n'), // Handle escaped newlines
          }
        });
        this.isConfigured = true;
        console.log('[GCSService] GCS initialized with credentials from GCS_KEY');
      } else {
        // Try to use individual environment variables as fallback
        const projectId = process.env.GCS_PROJECT_ID;
        const clientEmail = process.env.GCS_CLIENT_EMAIL;
        const privateKey = process.env.GCS_PRIVATE_KEY;

        if (projectId && clientEmail && privateKey) {
          this.storage = new Storage({
            projectId,
            credentials: {
              client_email: clientEmail,
              private_key: privateKey.replace(/\\n/g, '\n'), // Handle escaped newlines
            }
          });
          this.isConfigured = true;
          console.log('[GCSService] GCS initialized with individual credentials');
        } else {
          // Try default credentials (for local development with gcloud auth)
          this.storage = new Storage();
          this.isConfigured = true;
          console.log('[GCSService] GCS initialized with default credentials (gcloud auth)');
        }
      }
    } catch (error: any) {
      console.error('[GCSService] Failed to initialize GCS:', error.message);
      console.warn('[GCSService] File uploads will fail. Please check GCS_KEY or GCS credentials.');
      this.storage = null;
      this.isConfigured = false;
    }
  }

  async uploadFile(fileBuffer: Buffer, originalFilename: string, mimeType: string, folder: string = 'knowledge-base'): Promise<string> {
    if (!this.isConfigured || !this.storage) {
      throw new Error('GCS is not configured. Please set GCS_BUCKET_NAME and GCS_KEY (or GCS_PROJECT_ID, GCS_CLIENT_EMAIL, GCS_PRIVATE_KEY) environment variables.');
    }

    const fileExtension = originalFilename.split('.').pop();
    const filename = `${uuidv4()}.${fileExtension}`;
    const filePath = `${folder}/${filename}`;

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(filePath);

    // Upload file with metadata
    // Note: With uniform bucket-level access enabled, we can't use makePublic() or set object-level ACLs
    // File access is controlled by bucket-level IAM policies
    // If bucket is public, files will be accessible via public URL
    // If bucket is private, use getSignedUrl() to generate temporary access URLs
    await file.save(fileBuffer, {
      metadata: {
        contentType: mimeType,
      },
    });

    // Return the public URL format
    // Access depends on bucket IAM settings:
    // - If bucket has "allUsers" with "Storage Object Viewer" role, files are publicly accessible
    // - Otherwise, use getSignedUrl() method to generate temporary signed URLs
    return `https://storage.googleapis.com/${this.bucketName}/${filePath}`;
  }

  async deleteFile(url: string): Promise<void> {
    if (!this.isConfigured || !this.storage) {
      throw new Error('GCS is not configured. Please set GCS_BUCKET_NAME and GCS_KEY (or GCS_PROJECT_ID, GCS_CLIENT_EMAIL, GCS_PRIVATE_KEY) environment variables.');
    }

    // Extract file path from URL
    const urlParts = url.split('/');
    const filePath = urlParts.slice(urlParts.indexOf(this.bucketName) + 1).join('/');

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(filePath);

    await file.delete();
  }

  async getSignedUrl(url: string, expiresIn = 3600): Promise<string> {
    if (!this.isConfigured || !this.storage) {
      throw new Error('GCS is not configured. Please set GCS_BUCKET_NAME and GCS_KEY (or GCS_PROJECT_ID, GCS_CLIENT_EMAIL, GCS_PRIVATE_KEY) environment variables.');
    }

    // Extract file path from URL
    const urlParts = url.split('/');
    const filePath = urlParts.slice(urlParts.indexOf(this.bucketName) + 1).join('/');

    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(filePath);

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresIn * 1000,
    });

    return signedUrl;
  }
}

export const gcsService = new GCSService();

