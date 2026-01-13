import { Router } from 'express';
import { toolController } from '../controllers/tool.controller';
import { authenticate } from '../middleware/auth.middleware';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// GET /api/v1/tools - Get all tools
router.get('/', asyncHandler(toolController.getAll.bind(toolController)));

// GET /api/v1/tools/:toolId - Get tool by ID
router.get('/:toolId', asyncHandler(toolController.getById.bind(toolController)));

// POST /api/v1/tools/register - Register or update a tool
router.post('/register', asyncHandler(toolController.register.bind(toolController)));

// PUT /api/v1/tools/:toolId - Update a tool
router.put('/:toolId', asyncHandler(toolController.update.bind(toolController)));

// POST /api/v1/tools/delete - Delete a tool
router.post('/delete', asyncHandler(toolController.delete.bind(toolController)));

// GET /api/v1/tools/type/:toolType - Get tools by type
router.get('/type/:toolType', asyncHandler(toolController.getByType.bind(toolController)));

export default router;

