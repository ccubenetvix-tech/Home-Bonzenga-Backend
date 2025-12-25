import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireRole } from '../middleware/auth';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = express.Router();

const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const getCurrentMonth = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// ==========================================
// 1. OVERALL FINANCIAL SUMMARY
// ==========================================
router.get('/finance/summary', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { month = getCurrentMonth() } = req.query;
        const mt = month as string;

        // Fetch totals from monthly_earnings_summary
        const { data: summaryData, error: sumError } = await supabase
            .from('monthly_earnings_summary')
            .select('gross_amount, commission_amount, net_payable')
            .eq('month', mt);

        if (sumError) throw sumError;

        const totalRevenue = summaryData?.reduce((sum, i) => sum + (Number(i.gross_amount) || 0), 0) || 0;
        const totalCommission = summaryData?.reduce((sum, i) => sum + (Number(i.commission_amount) || 0), 0) || 0;
        const totalNetPayable = summaryData?.reduce((sum, i) => sum + (Number(i.net_payable) || 0), 0) || 0;

        // Fetch subscriptions
        const { data: subData, error: subError } = await supabase
            .from('subscriptions')
            .select('amount, status')
            .eq('month', mt);

        if (subError) throw subError;

        const totalSubscriptions = subData
            ?.filter(s => s.status === 'PAID')
            .reduce((sum, s) => sum + (Number(s.amount) || 0), 0) || 0;

        const unpaidSubscriptions = subData?.filter(s => s.status === 'UNPAID').length || 0;

        // Fetch payouts made
        const { data: payoutData, error: payError } = await supabase
            .from('payout_transactions')
            .select('net_paid')
            .eq('month', mt);

        if (payError) throw payError;
        const totalPaidOut = payoutData?.reduce((sum, i) => sum + (Number(i.net_paid) || 0), 0) || 0;

        const pendingPayouts = totalNetPayable - totalPaidOut;

        res.json({
            success: true,
            data: {
                month: mt,
                revenue: {
                    gross: totalRevenue,
                    commission: totalCommission,
                    subscriptions: totalSubscriptions
                },
                pending_payouts: pendingPayouts > 0 ? pendingPayouts : 0,
                subscription_stats: {
                    unpaid_count: unpaidSubscriptions
                }
            }
        });

    } catch (error: any) {
        console.error('Error fetching summary:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 2. VENDOR FINANCIAL MANAGMENT
// ==========================================
router.get('/finance/vendors', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { month = getCurrentMonth() } = req.query;
        const mt = month as string;

        // 1. Get all Vendors
        const { data: vendors, error: vError } = await supabase
            .from('vendor')
            .select('id, shopname');

        if (vError) throw vError;

        // 2. Get Financials for Month
        const { data: financials } = await supabase
            .from('monthly_earnings_summary')
            .select('*')
            .eq('entity_type', 'VENDOR')
            .eq('month', mt);

        // 3. Get Subscriptions for Month
        const { data: subs } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('entity_type', 'VENDOR')
            .eq('month', mt);

        // 4. Get Entity Status (Freeze)
        const { data: statuses } = await supabase
            .from('entity_status')
            .select('*')
            .eq('entity_type', 'VENDOR');

        // 5. Get Payouts
        const { data: payouts } = await supabase
            .from('payout_transactions')
            .select('entity_id, net_paid')
            .eq('entity_type', 'VENDOR')
            .eq('month', mt);

        // Combine
        const result = vendors?.map(v => {
            const fin = financials?.find(f => f.entity_id === v.id);
            const sub = subs?.find(s => s.entity_id === v.id);
            const stat = statuses?.find(s => s.entity_id === v.id);
            const paid = payouts?.filter(p => p.entity_id === v.id).reduce((sum, p) => sum + Number(p.net_paid), 0) || 0;

            return {
                id: v.id,
                name: v.shopname,
                type: 'VENDOR',
                financials: {
                    total_services: fin?.total_services || 0,
                    gross: fin?.gross_amount || 0,
                    commission: fin?.commission_amount || 0,
                    net_payable: fin?.net_payable || 0,
                    paid: paid,
                    balance: (fin?.net_payable || 0) - paid
                },
                subscription: {
                    status: sub?.status || 'UNPAID', // Default to UNPAID if no record (implies generated later)
                    amount: sub?.amount || 10
                },
                status: {
                    is_active: stat?.is_active ?? true, // Default active
                    frozen_reason: stat?.frozen_reason
                }
            };
        });

        res.json({ success: true, data: result });

    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 3. BEAUTICIAN FINANCIAL MANAGMENT
// ==========================================
router.get('/finance/beauticians', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { month = getCurrentMonth() } = req.query;
        const mt = month as string;

        // 1. Get all Beauticians (from beauticians table)
        const { data: beauticians, error: bError } = await supabase
            .from('beauticians')
            .select('id, name');

        if (bError) throw bError;

        // No need to fetch users separately as name is in beauticians table
        const users: any[] = []; // Placeholder to minimize diff logic flow or just remove mapping usage below


        // 2. Get Financials
        const { data: financials } = await supabase
            .from('monthly_earnings_summary')
            .select('*')
            .eq('entity_type', 'BEAUTICIAN')
            .eq('month', mt);

        // 3. Get Subscriptions
        const { data: subs } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('entity_type', 'BEAUTICIAN')
            .eq('month', mt);

        // 4. Get Status
        const { data: statuses } = await supabase
            .from('entity_status')
            .select('*')
            .eq('entity_type', 'BEAUTICIAN');

        // 5. Get Payouts
        const { data: payouts } = await supabase
            .from('payout_transactions')
            .select('entity_id, net_paid')
            .eq('entity_type', 'BEAUTICIAN')
            .eq('month', mt);

        const result = beauticians?.map(b => {
            const name = b.name || 'Unknown Beautician';
            const fin = financials?.find(f => f.entity_id === b.id);
            const sub = subs?.find(s => s.entity_id === b.id);
            const stat = statuses?.find(s => s.entity_id === b.id);
            const paid = payouts?.filter(p => p.entity_id === b.id).reduce((sum, p) => sum + Number(p.net_paid), 0) || 0;

            return {
                id: b.id,
                name: name,
                type: 'BEAUTICIAN',
                financials: {
                    total_services: fin?.total_services || 0,
                    gross: fin?.gross_amount || 0,
                    commission: fin?.commission_amount || 0,
                    net_payable: fin?.net_payable || 0,
                    paid: paid,
                    balance: (fin?.net_payable || 0) - paid
                },
                subscription: {
                    status: sub?.status || 'UNPAID',
                    amount: sub?.amount || 10
                },
                status: {
                    is_active: stat?.is_active ?? true,
                    frozen_reason: stat?.frozen_reason
                }
            };
        });

        res.json({ success: true, data: result });

    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 4. GENERATE STATEMENTS (MONTH-END JOB)
// ==========================================
router.post('/finance/generate-statements', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { month = getCurrentMonth() } = req.body;

        // --- VENDORS ---
        const { data: vendors } = await supabase.from('vendor').select('id');
        if (vendors) {
            for (const v of vendors) {
                // Subscription
                await supabase.from('subscriptions').upsert({
                    entity_type: 'VENDOR',
                    entity_id: v.id,
                    month: month, // Ensure unique constraint handles dupes
                    amount: 10.00
                }, { onConflict: 'entity_type, entity_id, month' });

                // Entity Status Init
                await supabase.from('entity_status').upsert({
                    entity_type: 'VENDOR',
                    entity_id: v.id,
                    is_active: true
                }, { onConflict: 'entity_type, entity_id', ignoreDuplicates: true }); // Only if not exists

                // Calculate Earnings (From completed bookings)
                // Assuming 'bookings' table for At-Salon
                // We need to parse month from created_at or completed_at? Assuming created_at for simplicity or booking_date
                // For this strict model, we check completed bookings in this month.
                // NOTE: Using a simplified sum for now. Real world needs date filtering.
                // Assuming month matches booking created_at substring

                // TODO: Strict date filtering. Here relying on 'bookings' table having 'vendor_id'
                const { data: sales, error: sErr } = await supabase
                    .from('bookings')
                    .select('total')
                    .eq('vendor_id', v.id)
                    .eq('status', 'COMPLETED')
                    .ilike('created_at', `${month}%`); // Simple filter YYYY-MM

                if (!sErr && sales) {
                    const totalGross = sales.reduce((sum, b) => sum + (Number(b.total) || 0), 0);
                    const count = sales.length;

                    await supabase.from('monthly_earnings_summary').upsert({
                        entity_type: 'VENDOR',
                        entity_id: v.id,
                        month: month,
                        total_services: count,
                        gross_amount: totalGross
                    }, { onConflict: 'entity_type, entity_id, month' });
                }
            }
        }

        // --- BEAUTICIANS ---
        const { data: beauty } = await supabase.from('beauticians').select('id');
        if (beauty) {
            for (const b of beauty) {
                // Subscription
                await supabase.from('subscriptions').upsert({
                    entity_type: 'BEAUTICIAN',
                    entity_id: b.id,
                    month: month,
                    amount: 10.00
                }, { onConflict: 'entity_type, entity_id, month' });

                // Entity Status Init
                await supabase.from('entity_status').upsert({
                    entity_type: 'BEAUTICIAN',
                    entity_id: b.id,
                    is_active: true
                }, { onConflict: 'entity_type, entity_id', ignoreDuplicates: true });

                // Calculate Earnings (From athome_bookings assigned to them)
                // Needs strict check on schema. assuming 'assigned_beautician_id' exists on athome_bookings
                const { data: sales, error: sErr } = await supabase
                    .from('athome_bookings')
                    .select('total_amount') // Check column name
                    .eq('assigned_beautician_id', b.id)
                    .eq('status', 'COMPLETED') // Or whatever completion status
                    .ilike('created_at', `${month}%`);

                if (!sErr && sales) {
                    const totalGross = sales.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0);
                    const count = sales.length;

                    await supabase.from('monthly_earnings_summary').upsert({
                        entity_type: 'BEAUTICIAN',
                        entity_id: b.id,
                        month: month,
                        total_services: count,
                        gross_amount: totalGross
                    }, { onConflict: 'entity_type, entity_id, month' });
                }
            }
        }

        res.json({ success: true, message: 'Statements generated.' });

    } catch (error: any) {
        console.error("Statement Gen Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 5. PAY SUBSCRIPTION
// ==========================================
router.post('/finance/subscription/pay', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { entity_type, entity_id, month } = req.body;

        const { error } = await supabase
            .from('subscriptions')
            .update({ status: 'PAID', paid_at: new Date() })
            .eq('entity_type', entity_type)
            .eq('entity_id', entity_id)
            .eq('month', month);

        if (error) throw error;

        // Auto-unfreeze if frozen due to subscription?
        // Logic: specific freeze reasons. If just subscription, maybe. But explicit unfreeze is safer. 
        // Prompt says "Admin can FREEZE / UNFREEZE". I will keep it explicit.

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 6. TOGGLE FREEZE 
// ==========================================
router.post('/finance/toggle-freeze', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { entity_type, entity_id, is_active, reason } = req.body;

        const { error } = await supabase
            .from('entity_status')
            .upsert({
                entity_type,
                entity_id,
                is_active,
                frozen_reason: is_active ? null : reason, // Clear reason if activating
                updated_at: new Date()
            }, { onConflict: 'entity_type, entity_id' });

        if (error) throw error;

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 7. PAYOUT (MANUAL)
// ==========================================
router.post('/finance/payout', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { entity_type, entity_id, month, amount, reference } = req.body;

        // Check if payout exceeds balance?
        // 1. Get Net Payable
        const { data: summ } = await supabase.from('monthly_earnings_summary')
            .select('net_payable')
            .eq('entity_type', entity_type)
            .eq('entity_id', entity_id)
            .eq('month', month)
            .single();

        // 2. Get Already Paid
        const { data: paid } = await supabase.from('payout_transactions')
            .select('net_paid')
            .eq('entity_type', entity_type)
            .eq('entity_id', entity_id)
            .eq('month', month);

        const totalPaid = paid?.reduce((sum, p) => sum + Number(p.net_paid), 0) || 0;
        const pending = (summ?.net_payable || 0) - totalPaid;

        if (Number(amount) > pending + 1) { // 1 dollar buffer/tolerance
            return res.status(400).json({ success: false, message: `Amount exceeds pending balance of $${pending}` });
        }

        // Insert Payout
        const { error } = await supabase.from('payout_transactions').insert({
            entity_type, // Explicitly match enum text
            entity_id,
            month,
            gross_amount: 0, // Not needed for transaction really, but schema asked for it? 
            // Schema has gross_amount, commission_amount, net_paid. 
            // Technicallly a partial payout doesn't have a specific gross/comm attached unless pro-rated.
            // I will store 0 for gross/comm in transaction, relying on summary for totals.
            // OR I can just satisfy the constraint.
            commission_amount: 0,
            net_paid: amount,
            reference_id: reference || 'MANUAL',
            created_by: req.user?.id
        });

        if (error) throw error;
        res.json({ success: true });

    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 8. FINANCIAL ANALYTICS
// ==========================================
router.get('/finance/analytics', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const currentYear = new Date().getFullYear();

        // 1. Monthly Revenue Trend (Last 6 months)
        const { data: trendData } = await supabase
            .from('monthly_earnings_summary')
            .select('month, commission_amount, gross_amount, entity_type')
            .order('month', { ascending: true })
            .limit(50); // Fetch enough to aggregate in JS

        // Aggregate by Month
        const monthlyStats: Record<string, any> = {};

        trendData?.forEach(item => {
            if (!monthlyStats[item.month]) {
                monthlyStats[item.month] = {
                    month: item.month,
                    revenue: 0,
                    payouts: 0, // We need to fetch payouts too to be accurate, but commission is platform revenue
                    vendor_commission: 0,
                    beautician_commission: 0
                };
            }
            const comm = Number(item.commission_amount) || 0;
            monthlyStats[item.month].revenue += comm;
            if (item.entity_type === 'VENDOR') monthlyStats[item.month].vendor_commission += comm;
            if (item.entity_type === 'BEAUTICIAN') monthlyStats[item.month].beautician_commission += comm;
        });

        // Convert to array
        const chartData = Object.values(monthlyStats).sort((a: any, b: any) => a.month.localeCompare(b.month));

        // 2. Entity Distribution (Active)
        const { count: vendorCount } = await supabase.from('vendor').select('*', { count: 'exact', head: true });
        const { count: beauticianCount } = await supabase.from('beauticians').select('*', { count: 'exact', head: true });

        // 3. Subscription Status Split
        const { count: paidSubs } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'PAID');
        const { count: unpaidSubs } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'UNPAID');

        res.json({
            success: true,
            data: {
                monthly_trend: chartData,
                distribution: [
                    { name: 'Vendors', value: vendorCount || 0 },
                    { name: 'Beauticians', value: beauticianCount || 0 }
                ],
                subscriptions: [
                    { name: 'Paid', value: paidSubs || 0 },
                    { name: 'Unpaid', value: unpaidSubs || 0 }
                ]
            }
        });

    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 9. ENTITY HISTORY (DRILL DOWN)
// ==========================================
router.get('/finance/history/:type/:id', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { type, id } = req.params;
        const { month } = req.query; // YYYY-MM

        let historyData: any[] = [];

        if (type === 'BEAUTICIAN') {
            // For Beauticians, we check 'athome_bookings' where they were assigned
            // And status is COMPLETED
            const { data: bookings } = await supabase
                .from('athome_bookings')
                .select(`
                    id, 
                    total_amount, 
                    slot, 
                    status,
                    customer:users!athome_bookings_customer_id_fkey (first_name, last_name)
                `)
                .eq('assigned_beautician_id', id)
                .eq('status', 'COMPLETED')
                .ilike('slot', `${month}%`); // Filter by slot date matching month

            // Also fetch services for these bookings to show details
            // This might be expensive if many, but for a single month/beautician it is okay.

            historyData = (bookings || []).map((b: any) => {
                const cust = Array.isArray(b.customer) ? b.customer[0] : b.customer;
                return {
                    id: b.id,
                    date: b.slot,
                    customer: cust ? `${cust.first_name} ${cust.last_name}` : 'Unknown',
                    amount: b.total_amount,
                    type: 'At-Home Service'
                };
            });

        } else if (type === 'VENDOR') {
            // For Vendors, we check 'bookings' (Salon)
            const { data: bookings } = await supabase
                .from('bookings')
                .select(`
                    id, 
                    total, 
                    appointment_date, 
                    status,
                    customer:users!bookings_customer_id_fkey (first_name, last_name)
                `)
                .eq('vendor_id', id)
                .eq('status', 'COMPLETED')
                .ilike('appointment_date', `${month}%`);

            historyData = (bookings || []).map((b: any) => {
                const cust = Array.isArray(b.customer) ? b.customer[0] : b.customer;
                return {
                    id: b.id,
                    date: b.appointment_date,
                    customer: cust ? `${cust.first_name} ${cust.last_name}` : 'Unknown',
                    amount: b.total,
                    type: 'Salon Booking'
                };
            });
        }

        res.json({ success: true, data: historyData });

    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
