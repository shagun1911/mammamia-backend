import { Router, Request, Response } from 'express';

const router = Router();

/**
 * Meta User Data Deletion Route
 * 
 * This is a public route required by Meta for Facebook Login compliance.
 * Meta will crawl this URL to verify it returns a 200 response.
 * 
 * Route: GET /meta/user-data-deletion
 * Access: Public (no authentication required)
 */
router.get('/user-data-deletion', (req: Request, res: Response) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>User Data Deletion</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      line-height: 1.6;
      color: #333;
    }
    h1 {
      color: #1877f2;
      border-bottom: 2px solid #1877f2;
      padding-bottom: 10px;
    }
    p {
      margin: 15px 0;
    }
    .email {
      font-weight: bold;
      color: #1877f2;
    }
  </style>
</head>
<body>
  <h1>User Data Deletion</h1>
  <p>If you want your data deleted from our system, please email us at <span class="email">support@keplero.ai</span>.</p>
  <p>We will process the request within 30 days as per Meta platform policies.</p>
</body>
</html>
  `);
});

export default router;

