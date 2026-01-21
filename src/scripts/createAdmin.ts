import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import Organization from '../models/Organization';
import { logger } from '../utils/logger.util';
import crypto from 'crypto';

dotenv.config();

interface CreateAdminOptions {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  organizationName?: string;
}

/**
 * Generate a secure random password
 */
function generateSecurePassword(length: number = 16): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
}

const createAdmin = async (options: CreateAdminOptions) => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('✅ Connected to MongoDB');

    // Validate email
    if (!options.email || !options.email.includes('@')) {
      logger.error('❌ Invalid email address');
      process.exit(1);
    }

    const email = options.email.toLowerCase().trim();
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      if (existingUser.role === 'admin') {
        // Update password if provided
        if (options.password) {
          logger.info(`⚠️  Admin user with email ${email} already exists!`);
          logger.info(`🔄 Updating password...`);
          existingUser.password = options.password;
          await existingUser.save();
          
          logger.info('✅ Admin password updated successfully!');
          logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          logger.info('📧 Email:    ' + existingUser.email);
          logger.info('🆔 User ID:  ' + existingUser._id);
          logger.info('🎭 Role:     ' + existingUser.role);
          logger.info('🔑 Password: ' + options.password);
          logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        } else {
          logger.warn(`⚠️  Admin user with email ${email} already exists!`);
          logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          logger.info('📧 Email:    ' + existingUser.email);
          logger.info('🆔 User ID:  ' + existingUser._id);
          logger.info('🎭 Role:     ' + existingUser.role);
          logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          logger.info('💡 To update password, run with --password option');
        }
        await mongoose.disconnect();
        process.exit(0);
      } else {
        // Update existing user to admin
        logger.info(`⚠️  User exists but is not admin. Updating to admin role...`);
        existingUser.role = 'admin';
        existingUser.permissions = ['all'];
        if (options.password) {
          existingUser.password = options.password;
        }
        await existingUser.save();
        
        logger.info('✅ User updated to admin successfully!');
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        logger.info('📧 Email:    ' + existingUser.email);
        logger.info('🆔 User ID:  ' + existingUser._id);
        logger.info('🎭 Role:     ' + existingUser.role);
        if (options.password) {
          logger.info('🔑 Password: ' + options.password);
        }
        logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        await mongoose.disconnect();
        process.exit(0);
      }
    }

    // Generate password if not provided
    const password = options.password || generateSecurePassword(16);
    const firstName = options.firstName || 'Admin';
    const lastName = options.lastName || 'User';

    // Create admin user
    const adminUser = await User.create({
      email,
      password,
      firstName,
      lastName,
      role: 'admin',
      permissions: ['all'],
      status: 'active',
      provider: 'local'
    });

    logger.info('✅ Admin user created successfully!');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📧 Email:    ' + adminUser.email);
    logger.info('🔑 Password: ' + password);
    logger.info('👤 Name:     ' + `${adminUser.firstName} ${adminUser.lastName}`);
    logger.info('🎭 Role:     ' + adminUser.role);
    logger.info('🆔 User ID:  ' + adminUser._id);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('\n💡 You can now use these credentials to login to the admin panel!');
    logger.info('🌐 Admin Panel URL: /admin');
    logger.info('\n⚠️  IMPORTANT: Save these credentials securely!');
    logger.info('   This password will not be shown again.');

    // Optionally create organization for admin
    if (options.organizationName) {
      const orgSlug = options.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const existingOrg = await Organization.findOne({ slug: orgSlug });
      
      if (!existingOrg) {
        const organization = await Organization.create({
          name: options.organizationName,
          slug: orgSlug,
          ownerId: adminUser._id,
          plan: 'enterprise',
          status: 'active'
        });
        
        adminUser.organizationId = organization._id;
        await adminUser.save();
        
        logger.info(`✅ Created organization: ${options.organizationName} (${orgSlug})`);
      } else {
        adminUser.organizationId = existingOrg._id;
        await adminUser.save();
        logger.info(`ℹ️  Linked to existing organization: ${options.organizationName}`);
      }
    }

    await mongoose.disconnect();
    logger.info('\n✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error creating admin user:', error.message);
    if (error.code === 11000) {
      logger.error('   Duplicate email - user already exists');
    }
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Parse command line arguments
const args = process.argv.slice(2);

const getArg = (key: string): string | undefined => {
  const equalFormat = args.find(arg => arg.startsWith(`--${key}=`));
  if (equalFormat) {
    return equalFormat.split('=').slice(1).join('=');
  }
  
  const keyIndex = args.indexOf(`--${key}`);
  if (keyIndex !== -1 && args[keyIndex + 1] && !args[keyIndex + 1].startsWith('--')) {
    return args[keyIndex + 1];
  }
  
  return undefined;
};

// Show usage if help is requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm run create:admin [options]

Options:
  --email=<email>              Admin email (required)
  --password=<password>        Admin password (optional, will generate secure password if not provided)
  --firstName=<name>          Admin first name (default: Admin)
  --lastName=<name>           Admin last name (default: User)
  --organizationName=<name>    Organization name (optional, creates organization for admin)
  --help, -h                  Show this help message

Environment Variables:
  ADMIN_EMAIL                  Admin email
  ADMIN_PASSWORD               Admin password (optional)
  ADMIN_FIRST_NAME             Admin first name
  ADMIN_LAST_NAME              Admin last name
  ORGANIZATION_NAME            Organization name

Examples:
  # Create admin with email only (auto-generates password)
  npm run create:admin -- --email=admin@company.com
  
  # Create admin with custom password
  npm run create:admin -- --email=admin@company.com --password=SecurePass123!
  
  # Create admin with organization
  npm run create:admin -- --email=admin@company.com --organizationName="Company Name"
  
  # PowerShell
  npm run create:admin -- --email admin@company.com --password SecurePass123!
  `);
  process.exit(0);
}

// Get values from command line or environment variables
const email = 
  getArg('email') ||
  process.env.ADMIN_EMAIL ||
  undefined;

const password = 
  getArg('password') ||
  process.env.ADMIN_PASSWORD ||
  undefined;

const firstName = 
  getArg('firstName') ||
  process.env.ADMIN_FIRST_NAME ||
  undefined;

const lastName = 
  getArg('lastName') ||
  process.env.ADMIN_LAST_NAME ||
  undefined;

const organizationName = 
  getArg('organizationName') ||
  process.env.ORGANIZATION_NAME ||
  undefined;

// Validate required fields
if (!email) {
  logger.error('❌ Email is required!');
  logger.error('');
  logger.error('Usage options:');
  logger.error('  1. Command line: npm run create:admin -- --email=admin@company.com');
  logger.error('  2. PowerShell:    npm run create:admin -- --email admin@company.com');
  logger.error('  3. Environment:   Set ADMIN_EMAIL env variable');
  logger.error('');
  logger.error('For more help: npm run create:admin -- --help');
  process.exit(1);
}

// Run the script
createAdmin({
  email,
  password,
  firstName,
  lastName,
  organizationName
});
