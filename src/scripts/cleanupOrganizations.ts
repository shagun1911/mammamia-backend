import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Organization from '../models/Organization';
import User from '../models/User';
import Profile from '../models/Profile';
import Plan from '../models/Plan';

dotenv.config();

/**
 * Cleanup Script
 * 1. Remove duplicate Organizations (same name).
 * 2. Soft-delete inactive organizations (no owner, no plan, old).
 * 3. Ensure Plans are linked correctly.
 * 4. Create usage Profiles for active organizations.
 */
const cleanup = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI as string);
        console.log('📦 Connected to MongoDB');

        // 1. DEDUPLICATION
        console.log('\n🧹 Starting Deduplication...');
        const allOrgs = await Organization.find().sort({ createdAt: -1 });
        const nameMap = new Map<string, any[]>();

        for (const org of allOrgs) {
            if (!org.name) continue;
            const normalized = org.name.trim().toLowerCase();
            if (!nameMap.has(normalized)) nameMap.set(normalized, []);
            nameMap.get(normalized)?.push(org);
        }

        for (const [name, orgs] of nameMap) {
            if (orgs.length > 1) {
                console.log(`Found ${orgs.length} duplicates for "${name}"`);
                // Pick winner: Prefer one with planId, then one with ownerId, then newest
                let winner = orgs[0]; // Default to newest (since we sorted desc)

                // Try to find a better winner
                const withPlan = orgs.find(o => o.planId);
                if (withPlan) winner = withPlan;

                console.log(`Keeping winner: ${winner._id} (${winner.plan || 'no-plan'})`);

                // Delete others
                for (const org of orgs) {
                    if (org._id.toString() !== winner._id.toString()) {
                        console.log(`Deleting duplicate: ${org._id}`);
                        // Move users?
                        await User.updateMany({ organizationId: org._id }, { organizationId: winner._id });
                        await Organization.findByIdAndDelete(org._id);
                        // Also clean up profiles linked to this org
                        await Profile.deleteMany({ organizationId: org._id });
                    }
                }
            }
        }

        // 2. LINK PLANS
        console.log('\n🔗 Linking Plans...');
        const plans = await Plan.find().lean();
        const planMap = plans.reduce((acc, p) => ({ ...acc, [p.slug]: p._id }), {} as any);

        const orgsWithoutPlanId = await Organization.find({ planId: { $exists: false }, status: { $ne: 'deleted' } });
        for (const org of orgsWithoutPlanId) {
            if (org.plan && planMap[org.plan]) {
                org.planId = planMap[org.plan];
                await org.save();
                console.log(`Linked org ${org.name} to plan ${org.plan}`);
            } else if (!org.plan || org.plan === 'free') {
                // Link to free plan if exists
                if (planMap['free']) {
                    org.planId = planMap['free'];
                    org.plan = 'free';
                    await org.save();
                    console.log(`Defaulted org ${org.name} to free plan`);
                }
            }
        }

        // 3. ENSURE PROFILES (Usage Trackers)
        console.log('\n📊 Ensuring Usage Profiles...');

        try {
            // Drop legacy unique index on userId to allow nulls
            await Profile.collection.dropIndex('userId_1');
            console.log('Dropped legacy unique index on userId');
        } catch (e: any) {
            // Ignore "index not found" error
            if (e.code !== 27) console.log('Index drop info:', e.message);
        }

        const activeOrgs = await Organization.find({ status: 'active' });
        for (const org of activeOrgs) {
            const profile = await Profile.findOne({ organizationId: org._id });
            if (!profile) {
                console.log(`Creating profile for ${org.name}`);
                const now = new Date();
                const end = new Date();
                end.setMonth(end.getMonth() + 1);
                await Profile.create({
                    organizationId: org._id,
                    billingCycleStart: now,
                    billingCycleEnd: end,
                    isActive: true,
                    chatConversationsUsed: 0,
                    voiceMinutesUsed: 0,
                    automationsUsed: 0
                });
            }
        }

        console.log('\n✅ Cleanup Complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
};

cleanup();
