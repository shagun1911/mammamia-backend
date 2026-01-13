import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';

export class WebScraperService {
  async scrapePage(url: string): Promise<{ title: string; content: string }> {
    try {
      // Try simple HTTP request first
      const response = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(response.data);

      // Remove script, style, and other non-content tags
      $('script, style, nav, header, footer, iframe, noscript').remove();

      const title = $('title').text() || $('h1').first().text() || 'Untitled';
      const content = $('body').text().replace(/\s+/g, ' ').trim();

      return { title, content };
    } catch (error) {
      // If simple request fails, try with Puppeteer (for JS-heavy sites)
      return await this.scrapeWithPuppeteer(url);
    }
  }

  async scrapeWithPuppeteer(url: string): Promise<{ title: string; content: string }> {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Get title
      const title = await page.title().catch(() => 'Untitled');
      
      // Get content
      const content = await page.evaluate(() => {
        const body = (global as any).document?.body || { innerText: '' };
        return body.innerText.replace(/\s+/g, ' ').trim();
      });

      const data = { title, content };

      await browser.close();
      return data;
    } catch (error: any) {
      await browser.close();
      throw new Error(`Failed to scrape ${url}: ${error.message}`);
    }
  }

  async findSitemap(domain: string): Promise<string[]> {
    const sitemapUrls = [
      `https://${domain}/sitemap.xml`,
      `https://${domain}/sitemap_index.xml`,
      `https://www.${domain}/sitemap.xml`
    ];

    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await axios.get(sitemapUrl, { timeout: 5000 });
        const $ = cheerio.load(response.data, { xmlMode: true });
        const urls: string[] = [];

        $('url loc').each((_, element) => {
          urls.push($(element).text());
        });

        if (urls.length > 0) {
          return urls;
        }
      } catch (error) {
        continue;
      }
    }

    return [];
  }

  async crawlDomain(domain: string, maxPages = 100): Promise<string[]> {
    // Try sitemap first
    const sitemapUrls = await this.findSitemap(domain);
    if (sitemapUrls.length > 0) {
      return sitemapUrls.slice(0, maxPages);
    }

    // If no sitemap, do basic crawl (simplified version)
    const urls: string[] = [];
    const visited = new Set<string>();
    const toVisit = [`https://${domain}`];

    while (toVisit.length > 0 && urls.length < maxPages) {
      const url = toVisit.shift()!;
      
      if (visited.has(url)) continue;
      visited.add(url);

      try {
        const response = await axios.get(url, { timeout: 5000 });
        const $ = cheerio.load(response.data);

        urls.push(url);

        // Find more links on the same domain
        $('a[href]').each((_, element) => {
          const href = $(element).attr('href');
          if (!href) return;

          let fullUrl: string;
          if (href.startsWith('http')) {
            fullUrl = href;
          } else if (href.startsWith('/')) {
            fullUrl = `https://${domain}${href}`;
          } else {
            return;
          }

          // Only add URLs from the same domain
          if (fullUrl.includes(domain) && !visited.has(fullUrl)) {
            toVisit.push(fullUrl);
          }
        });
      } catch (error: any) {
        console.error(`Failed to crawl ${url}:`, error.message);
      }
    }

    return urls;
  }
}

export const webScraperService = new WebScraperService();

