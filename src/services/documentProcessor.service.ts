const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';
import csvParser from 'csv-parser';
import { Readable } from 'stream';

export class DocumentProcessorService {
  async extractTextFromPDF(buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text;
    } catch (error: any) {
      throw new Error(`Failed to extract text from PDF: ${error.message}`);
    }
  }

  async extractTextFromDOCX(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error: any) {
      throw new Error(`Failed to extract text from DOCX: ${error.message}`);
    }
  }

  async extractTextFromCSV(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const rows: string[] = [];
      const stream = Readable.from(buffer);

      stream
        .pipe(csvParser())
        .on('data', (row) => {
          rows.push(Object.values(row).join(' '));
        })
        .on('end', () => {
          resolve(rows.join('\n'));
        })
        .on('error', reject);
    });
  }

  async extractTextFromTXT(buffer: Buffer): Promise<string> {
    return buffer.toString('utf-8');
  }

  async processFile(buffer: Buffer, fileType: string): Promise<string> {
    switch (fileType) {
      case 'application/pdf':
        return await this.extractTextFromPDF(buffer);
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return await this.extractTextFromDOCX(buffer);
      case 'text/csv':
        return await this.extractTextFromCSV(buffer);
      case 'text/plain':
        return await this.extractTextFromTXT(buffer);
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }
}

export const documentProcessorService = new DocumentProcessorService();

