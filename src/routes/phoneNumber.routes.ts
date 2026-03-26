import { Router } from 'express';
import { phoneNumberController } from '../controllers/phoneNumber.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkPlanStatus, enforceCallMinutesLimit } from '../middleware/planEnforcement.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(checkPlanStatus);

// ============================================================================
// STEP 2: ROUTE-LEVEL GUARANTEE
// Log when ANY phone-number route is matched (proves routing is correct)
// ============================================================================
router.use((req, res, next) => {
  console.log('📍 [PHONE NUMBER ROUTE] ========================================');
  console.log('📍 [PHONE NUMBER ROUTE] Route matched!');
  console.log('📍 [PHONE NUMBER ROUTE] Method:', req.method);
  console.log('📍 [PHONE NUMBER ROUTE] Path:', req.path);
  console.log('📍 [PHONE NUMBER ROUTE] Original URL:', req.originalUrl);
  console.log('📍 [PHONE NUMBER ROUTE] ========================================');
  next();
});

// GET /api/v1/phone-numbers - List phone numbers
router.get('/', phoneNumberController.list);

// POST /api/v1/phone-numbers - Create phone number ONLY
// HARD STOP: This endpoint ONLY creates phone number, returns phone_number_id
// NO SIP setup, NO agent config, NO phone settings update
router.post('/', enforceCallMinutesLimit, phoneNumberController.create);

// POST /api/v1/phone-numbers/sip-trunk - Create SIP trunk phone number
// Returns phone_number_id only
// IMPORTANT: This must come BEFORE /:phone_number_id routes
router.post('/sip-trunk', enforceCallMinutesLimit, phoneNumberController.createSipTrunk);

// GET /api/v1/phone-numbers/:phone_number_id - Get phone number by ID
router.get('/:phone_number_id', phoneNumberController.getById);

// POST /api/v1/phone-numbers/:phone_number_id/register - Register phone number with Python API
// This comes after GET to avoid route conflicts
router.post('/:phone_number_id/register', phoneNumberController.registerWithPython);

// PATCH /api/v1/phone-numbers/:phone_number_id - Update phone number
router.patch('/:phone_number_id', phoneNumberController.update);

// DELETE /api/v1/phone-numbers/:phone_number_id - Delete phone number
router.delete('/:phone_number_id', phoneNumberController.delete);

export default router;
