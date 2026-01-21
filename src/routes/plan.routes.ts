import { Router } from 'express';
import { body } from 'express-validator';
import { planController } from '../controllers/plan.controller';
import { authenticate } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// All plan routes require authentication
router.use(authenticate);

// Public routes (authenticated users can view plans)
router.get('/', planController.getAllPlans.bind(planController));
router.get('/:id', planController.getPlanById.bind(planController));

// Admin-only routes
router.post('/', requireAdmin, planController.createPlan.bind(planController));
router.put('/:id', requireAdmin, planController.updatePlan.bind(planController));
router.delete('/:id', requireAdmin, planController.deletePlan.bind(planController));
router.post('/assign', 
  requireAdmin,
  validate([
    body('organizationId').notEmpty().withMessage('Organization ID is required').isString().withMessage('Organization ID must be a string'),
    body('planId').notEmpty().withMessage('Plan ID is required').isString().withMessage('Plan ID must be a string')
  ]),
  planController.assignPlanToOrganization.bind(planController)
);

export default router;
