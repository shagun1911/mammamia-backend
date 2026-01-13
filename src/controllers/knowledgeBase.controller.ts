import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { KnowledgeBaseService } from '../services/knowledgeBase.service';
import { WebScraperService } from '../services/webScraper.service';
import { S3Service } from '../services/s3.service';
import { DocumentProcessorService } from '../services/documentProcessor.service';
import { successResponse, paginatedResponse } from '../utils/response.util';
import { AppError } from '../middleware/error.middleware';

export class KnowledgeBaseController {
  private kbService: KnowledgeBaseService;
  private scraperService: WebScraperService;
  private s3Service: S3Service;
  private docProcessor: DocumentProcessorService;

  constructor() {
    this.kbService = new KnowledgeBaseService();
    this.scraperService = new WebScraperService();
    this.s3Service = new S3Service();
    this.docProcessor = new DocumentProcessorService();
  }

  // ===== Knowledge Base =====
  
  getAllKnowledgeBases = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new AppError(401, 'UNAUTHORIZED', 'User ID not found');
      }
      const knowledgeBases = await this.kbService.findAll(userId);
      res.json(successResponse(knowledgeBases));
    } catch (error) {
      next(error);
    }
  };

  createKnowledgeBase = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { name, url_links } = req.body;
      const userId = req.user!.id;
      
      // Validate required fields
      if (!name || typeof name !== 'string' || name.trim() === '') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Knowledge base name is required');
      }
      
      // Get uploaded files
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const pdfFiles = files?.pdf_files || [];
      const excelFiles = files?.excel_files || [];

      // Parse URL links (comma-separated string)
      const urlLinksArray = url_links ? url_links.split(',').map((url: string) => url.trim()).filter(Boolean) : [];

      // Create knowledge base with data sources
      // This will call /rag/data_ingestion to create collection and ingest data, then save to DB
      const kb = await this.kbService.create(name.trim(), userId, {
        urlLinks: urlLinksArray,
        pdfFiles: pdfFiles.map(f => f.buffer),
        excelFiles: excelFiles.map(f => f.buffer)
      });
      
      const hasData = urlLinksArray.length > 0 || pdfFiles.length > 0 || excelFiles.length > 0;
      const message = hasData 
        ? 'Knowledge base created and data ingestion completed'
        : 'Knowledge base created successfully';
      
      res.status(201).json(successResponse(kb, message));
    } catch (error) {
      next(error);
    }
  };

  deleteKnowledgeBase = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.kbService.delete(req.params.kbId);
      res.json(successResponse(result, 'Knowledge base deleted'));
    } catch (error) {
      next(error);
    }
  };

  getSpaceUsage = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const usage = await this.kbService.getSpaceUsage(req.params.kbId);
      res.json(successResponse(usage));
    } catch (error) {
      next(error);
    }
  };

  // ===== FAQs =====

  getAllFAQs = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { page = 1, limit = 20, search } = req.query;
      const result = await this.kbService.findAllFAQs(
        req.params.kbId,
        Number(page),
        Number(limit),
        search as string
      );
      res.json(paginatedResponse(
        result.items,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total
      ));
    } catch (error) {
      next(error);
    }
  };

  createFAQ = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { question, answer } = req.body;
      const faq = await this.kbService.createFAQ(req.params.kbId, question, answer);
      res.status(201).json(successResponse(faq, 'FAQ created'));
    } catch (error) {
      next(error);
    }
  };

  updateFAQ = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { question, answer } = req.body;
      const faq = await this.kbService.updateFAQ(req.params.faqId, question, answer);
      res.json(successResponse(faq, 'FAQ updated'));
    } catch (error) {
      next(error);
    }
  };

  deleteFAQ = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.kbService.deleteFAQ(req.params.faqId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  importFAQs = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
      }

      const csvContent = req.file.buffer.toString('utf-8');
      const result = await this.kbService.importFAQsFromCSV(req.params.kbId, csvContent);
      res.json(successResponse(result, 'FAQs imported'));
    } catch (error) {
      next(error);
    }
  };

  // ===== Websites =====

  getAllWebsites = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const websites = await this.kbService.findAllWebsites(req.params.kbId);
      res.json(successResponse(websites));
    } catch (error) {
      next(error);
    }
  };

  addWebsite = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { domain, includeSubdomains = false, maxPages = 100 } = req.body;

      // Create website record
      const website = await this.kbService.addWebsite(req.params.kbId, domain);

      // Start scraping in background (don't await)
      this.startWebsiteScraping((website._id as any).toString(), domain, maxPages);

      res.json(successResponse({
        id: (website._id as any).toString(),
        domain: website.domain,
        status: 'scanning',
        pagesFound: 0,
        message: 'Scanning website... This may take a few minutes.'
      }));
    } catch (error) {
      next(error);
    }
  };

  addWebsiteURLs = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { urls } = req.body;

      if (!Array.isArray(urls) || urls.length === 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'URLs array is required');
      }

      const result = await this.kbService.addWebsiteURLs(req.params.kbId, urls);

      // Start scraping each URL in background
      for (const url of urls) {
        this.scrapeURL(url);
      }

      res.json(successResponse(result, 'URLs added'));
    } catch (error) {
      next(error);
    }
  };

  updateWebsite = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { websiteId } = req.params;
      
      // Re-scrape all pages
      const Website = (await import('../models/Website')).default;
      const website = await Website.findById(websiteId);

      if (!website) {
        throw new AppError(404, 'NOT_FOUND', 'Website not found');
      }

      // Set all pages to pending
      website.pages.forEach(page => {
        page.status = 'pending';
      });
      await website.save();

      // Start re-scraping
      for (const page of website.pages) {
        this.scrapeURL(page.url);
      }

      res.json(successResponse({
        id: website._id,
        status: 'updating',
        message: 'Re-scraping website...'
      }));
    } catch (error) {
      next(error);
    }
  };

  deleteWebsite = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.kbService.deleteWebsite(req.params.websiteId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  deleteWebsitePage = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { websiteId, pageId } = req.params;
      const result = await this.kbService.deleteWebsitePage(websiteId, pageId);
      res.json(successResponse(result));
    } catch (error) {
      next(error);
    }
  };

  // ===== Files =====

  getAllFiles = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const files = await this.kbService.findAllFiles(req.params.kbId);
      res.json(successResponse(files));
    } catch (error) {
      next(error);
    }
  };

  uploadFile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        throw new AppError(400, 'VALIDATION_ERROR', 'No file uploaded');
      }

      const { kbId } = req.params;
      const isPdf = req.file.mimetype === 'application/pdf';
      const isExcel = req.file.mimetype.includes('spreadsheet') || req.file.mimetype.includes('excel');

      // Upload to S3
      const url = await this.s3Service.uploadFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype
      );

      // Create file record
      const file = await this.kbService.createFileRecord(
        kbId,
        req.file.filename,
        req.file.originalname,
        req.file.mimetype,
        req.file.size,
        url
      );

      // Ingest into Python RAG system directly
      try {
        console.log(`[KB Controller] Ingesting file ${req.file.originalname} into Python RAG`);
        
        if (isPdf) {
          await this.kbService.ingestIntoRAG(kbId, {
            pdfFiles: [req.file.buffer]
          });
        } else if (isExcel) {
          await this.kbService.ingestIntoRAG(kbId, {
            excelFiles: [req.file.buffer]
          });
        }
        
        // Update file status to processed
        await this.kbService.updateFileContent((file._id as any).toString(), '', 'processed');
        
        console.log('[KB Controller] ✅ File ingested successfully into Python RAG');
      } catch (error: any) {
        console.error('[KB Controller] Failed to ingest file into Python RAG:', error);
        await this.kbService.updateFileContent((file._id as any).toString(), '', 'failed');
      }

      res.json(successResponse({
        id: file._id,
        filename: file.originalFilename,
        size: file.size,
        status: 'processed',
        message: 'File uploaded and ingested successfully'
      }));
    } catch (error) {
      next(error);
    }
  };

  deleteFile = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const result = await this.kbService.deleteFile(req.params.fileId);
      
      // Delete from S3
      await this.s3Service.deleteFile(result.file.url);

      res.json(successResponse({ message: result.message }));
    } catch (error) {
      next(error);
    }
  };

  // ===== Background Processing Methods =====

  private async startWebsiteScraping(websiteId: string, domain: string, maxPages: number) {
    try {
      const Website = (await import('../models/Website')).default;
      const website = await Website.findById(websiteId);

      if (!website) return;

      // Find URLs to scrape
      const urls = await this.scraperService.crawlDomain(domain, maxPages);

      // Add pages to website
      for (const url of urls) {
        const pageExists = website.pages.some(p => p.url === url);
        if (!pageExists) {
          website.pages.push({
            url,
            title: '',
            content: '',
            status: 'pending'
          });
        }
      }

      website.pagesCount = website.pages.length;
      await website.save();

      // Scrape each page
      for (const page of website.pages) {
        await this.scrapeURL(page.url);
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      console.error('Website scraping error:', error);
    }
  }

  private async scrapeURL(url: string) {
    try {
      const Website = (await import('../models/Website')).default;

      // Extract domain from URL
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      // Find the website document
      const website = await Website.findOne({ domain });
      if (!website) return;

      // Find the page
      const pageIndex = website.pages.findIndex(p => p.url === url);
      if (pageIndex === -1) return;

      // Scrape the page
      const { title, content } = await this.scraperService.scrapePage(url);

      // Update page
      website.pages[pageIndex].title = title;
      website.pages[pageIndex].content = content;
      website.pages[pageIndex].status = 'active';
      website.pages[pageIndex].lastScraped = new Date();

      website.lastUpdated = new Date();
      await website.save();

    } catch (error) {
      console.error(`Error scraping ${url}:`, error);

      // Mark page as failed
      const Website = (await import('../models/Website')).default;
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      const website = await Website.findOne({ domain });
      if (website) {
        const pageIndex = website.pages.findIndex(p => p.url === url);
        if (pageIndex !== -1) {
          website.pages[pageIndex].status = 'failed';
          await website.save();
        }
      }
    }
  }

  private async processFile(fileId: string, buffer: Buffer, fileType: string) {
    try {
      // Extract text from file
      const extractedContent = await this.docProcessor.processFile(buffer, fileType);

      // Update file record
      await this.kbService.updateFileContent(fileId, extractedContent, 'processed');

    } catch (error) {
      console.error('File processing error:', error);
      await this.kbService.updateFileContent(fileId, '', 'failed');
    }
  }
}

export const knowledgeBaseController = new KnowledgeBaseController();

