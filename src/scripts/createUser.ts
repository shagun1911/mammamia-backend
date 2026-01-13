import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User';
import Organization from '../models/Organization';
import { logger } from '../utils/logger.util';

dotenv.config();

interface CreateUserOptions {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: 'admin' | 'operator' | 'viewer';
  organizationId?: string;
  createOrganization?: boolean;
  organizationName?: string;
}

const createUser = async (options: CreateUserOptions) => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chatbot_platform');
    logger.info('✅ Connected to MongoDB');

    // Check if user already exists
    const existingUser = await User.findOne({ email: options.email.toLowerCase() });
    if (existingUser) {
      logger.warn(`⚠️  User with email ${options.email} already exists!`);
      logger.info('Email: ' + existingUser.email);
      logger.info('ID: ' + existingUser._id);
      await mongoose.disconnect();
      process.exit(0);
    }

    let organizationId = options.organizationId;

    // Create organization if requested (we'll create user first, then org)
    if (options.createOrganization && options.organizationName) {
      const orgSlug = options.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      // Check if organization already exists
      const existingOrg = await Organization.findOne({ slug: orgSlug });
      
      if (existingOrg) {
        logger.info(`ℹ️  Using existing organization: ${options.organizationName}`);
        organizationId = existingOrg._id.toString();
      }
      // We'll create the organization after creating the user
    }

    // Create the user first
    const user = await User.create({
      email: options.email.toLowerCase(),
      password: options.password, // Will be hashed automatically by pre-save hook
      firstName: options.firstName,
      lastName: options.lastName,
      role: options.role || 'operator',
      permissions: options.role === 'admin' ? ['all'] : [],
      status: 'active',
      organizationId: organizationId ? new mongoose.Types.ObjectId(organizationId) : undefined,
      provider: 'local'
    });

    // Now create organization if requested and it doesn't exist
    if (options.createOrganization && options.organizationName && !organizationId) {
      const orgSlug = options.organizationName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const organization = await Organization.create({
        name: options.organizationName,
        slug: orgSlug,
        ownerId: user._id, // Use the newly created user as owner
        plan: 'free',
        status: 'active'
      });
      
      // Update user with organization ID
      user.organizationId = organization._id;
      await user.save();
      
      organizationId = organization._id.toString();
      logger.info(`✅ Created organization: ${options.organizationName} (${orgSlug})`);
    }

    logger.info('\n✅ User created successfully!');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📧 Email:    ' + user.email);
    logger.info('🔑 Password: ' + options.password);
    logger.info('👤 Name:     ' + `${user.firstName} ${user.lastName}`);
    logger.info('🎭 Role:     ' + user.role);
    logger.info('🆔 User ID:  ' + user._id);
    if (user.organizationId) {
      logger.info('🏢 Org ID:   ' + user.organizationId);
    }
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('\n💡 You can now use these credentials to login!');

    await mongoose.disconnect();
    logger.info('\n✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error creating user:', error.message);
    if (error.code === 11000) {
      logger.error('   Duplicate email - user already exists');
    }
    await mongoose.disconnect();
    process.exit(1);
  }
};

// Parse command line arguments or use defaults
const args = process.argv.slice(2);

// Helper function to get argument value (handles both --key=value and --key value formats)
const getArg = (key: string): string | undefined => {
  // Try --key=value format
  const equalFormat = args.find(arg => arg.startsWith(`--${key}=`));
  if (equalFormat) {
    return equalFormat.split('=').slice(1).join('='); // Handle values with = in them
  }
  
  // Try --key value format
  const keyIndex = args.indexOf(`--${key}`);
  if (keyIndex !== -1 && args[keyIndex + 1] && !args[keyIndex + 1].startsWith('--')) {
    return args[keyIndex + 1];
  }
  
  return undefined;
};

// Get values from command line or environment variables
const email = 
  getArg('email') ||
  process.env.USER_EMAIL ||
  undefined;

const password = 
  getArg('password') ||
  process.env.USER_PASSWORD ||
  undefined;

const firstName = 
  getArg('firstName') ||
  process.env.USER_FIRST_NAME ||
  'John';

const lastName = 
  getArg('lastName') ||
  process.env.USER_LAST_NAME ||
  'Doe';

const role = 
  (getArg('role') ||
  process.env.USER_ROLE ||
  'operator') as 'admin' | 'operator' | 'viewer';

const organizationId = 
  getArg('organizationId') ||
  process.env.USER_ORGANIZATION_ID ||
  undefined;

const createOrganization = 
  args.includes('--create-org') ||
  process.env.CREATE_ORGANIZATION === 'true';

const organizationName = 
  getArg('organizationName') ||
  process.env.ORGANIZATION_NAME ||
  undefined;

// Show usage if help is requested
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: npm run create:user [options]

Options:
  --email=<email>              User email (required)
  --password=<password>        User password (required)
  --firstName=<name>          User first name
  --lastName=<name>           User last name
  --role=<role>               User role: admin, operator, viewer (default: operator)
  --organizationId=<id>        Existing organization ID to assign user to
  --create-org                Create a new organization
  --organizationName=<name>    Organization name (required if --create-org)
  --help, -h                  Show this help message

Environment Variables:
  USER_EMAIL                  User email
  USER_PASSWORD               User password
  USER_FIRST_NAME             User first name
  USER_LAST_NAME              User last name
  USER_ROLE                   User role
  USER_ORGANIZATION_ID        Organization ID
  CREATE_ORGANIZATION         Set to 'true' to create organization
  ORGANIZATION_NAME           Organization name

Examples:
  # Bash/Linux/Mac (with =)
  npm run create:user -- --email=admin@test.com --password=admin123 --role=admin
  
  # PowerShell (with = or space)
  npm run create:user -- --email=admin@test.com --password=admin123 --role=admin
  npm run create:user -- --email admin@test.com --password admin123 --role admin
  
  # With organization
  npm run create:user -- --email=user@test.com --password=pass123 --create-org --organizationName="My Company"
  
  # Assign to existing organization
  npm run create:user -- --email=operator@test.com --password=op123 --organizationId=507f1f77bcf86cd799439011
  `);
  process.exit(0);
}

// Validate required fields
if (!email) {
  logger.error('❌ Email is required!');
  logger.error('');
  logger.error('Usage options:');
  logger.error('  1. Command line: npm run create:user -- --email=user@test.com --password=pass123');
  logger.error('  2. PowerShell:    npm run create:user -- --email user@test.com --password pass123');
  logger.error('  3. Environment:   Set USER_EMAIL and USER_PASSWORD env variables');
  logger.error('');
  logger.error('For more help: npm run create:user -- --help');
  process.exit(1);
}

if (!password) {
  logger.error('❌ Password is required!');
  logger.error('');
  logger.error('Usage options:');
  logger.error('  1. Command line: npm run create:user -- --email=user@test.com --password=pass123');
  logger.error('  2. PowerShell:    npm run create:user -- --email user@test.com --password pass123');
  logger.error('  3. Environment:   Set USER_EMAIL and USER_PASSWORD env variables');
  logger.error('');
  logger.error('For more help: npm run create:user -- --help');
  process.exit(1);
}

// Run the script
createUser({
  email,
  password,
  firstName,
  lastName,
  role,
  organizationId,
  createOrganization,
  organizationName
});

