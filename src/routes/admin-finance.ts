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
        const isLifetime = mt === 'lifetime' || mt === 'all';

        let vendorTotals = { gross: 0, commission: 0, net_payable: 0 };
        let beauticianTotals = { gross: 0, commission: 0, net_payable: 0 };

        if (isLifetime) {
            // LIFETIME MODE: Calculate directly from raw tables using consistent logic with Monthly

            // 1. Vendor (Salon) Bookings
            // Match Monthly Logic: Source vendor_orders, Status CONFIRMED/PAID/COMPLETED
            const { data: salonBookings, error: sErr } = await supabase
                .from('vendor_orders')
                .select('total_amount')
                .in('booking_status', ['CONFIRMED', 'PAID', 'COMPLETED']);

            if (sErr) throw sErr;

            const salonGross = salonBookings?.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0) || 0;
            const salonComm = salonGross * 0.15; // Match 15% used in Monthly
            const salonNet = salonGross - salonComm;

            vendorTotals = { gross: salonGross, commission: salonComm, net_payable: salonNet };

            // 2. Beautician (At-Home) Bookings
            // Match Monthly Logic: Source athome_bookings, Payment SUCCESS
            const { data: homeBookings, error: hErr } = await supabase
                .from('athome_bookings')
                .select('total_amount')
                .eq('payment_status', 'SUCCESS');

            if (hErr) throw hErr;

            const homeGross = homeBookings?.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0) || 0;
            const homeComm = homeGross * 0.15; // Match 15% used in Monthly
            const homeNet = homeGross - homeComm;

            beauticianTotals = { gross: homeGross, commission: homeComm, net_payable: homeNet };

        } else {
            // MONTHLY MODE: Use the Summary Table (Fallback) or Calculate Live
            // For accuracy, we will calculate LIVE like the details endpoints
            const startDate = `${mt}-01`;
            const nextMonth = new Date(`${mt}-01`);
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            const endDate = nextMonth.toISOString().split('T')[0];

            // Vendors Live
            const { data: vOrders } = await supabase
                .from('vendor_orders')
                .select('total_amount')
                .in('booking_status', ['CONFIRMED', 'PAID', 'COMPLETED'])
                .gte('created_at', startDate)
                .lt('created_at', endDate);

            const vGross = vOrders?.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) || 0;
            vendorTotals = { gross: vGross, commission: vGross * 0.15, net_payable: vGross * 0.85 };

            // Beauticians Live
            const { data: bBookings } = await supabase
                .from('athome_bookings')
                .select('total_amount')
                .eq('payment_status', 'SUCCESS')
                .gte('created_at', startDate)
                .lt('created_at', endDate);

            const bGross = bBookings?.reduce((sum, b) => sum + (Number(b.total_amount) || 0), 0) || 0;
            beauticianTotals = { gross: bGross, commission: bGross * 0.15, net_payable: bGross * 0.85 };
        }

        const totalRevenue = vendorTotals.gross + beauticianTotals.gross;
        // ... (rest of summary logic remains similar, ensuring commission rates match) ...

        const totalCommission = vendorTotals.commission + beauticianTotals.commission;


        // Fetch subscriptions
        let subQuery = supabase.from('subscriptions').select('amount, status, entity_type');
        if (!isLifetime) {
            subQuery = subQuery.eq('month', mt);
        }
        const { data: subData, error: subError } = await subQuery;

        if (subError) throw subError;

        const subStats = (type: string) => {
            const items = subData?.filter(s => s.entity_type === type) || [];
            return {
                paid_amount: items.filter(s => s.status === 'PAID').reduce((sum, s) => sum + (Number(s.amount) || 0), 0),
                unpaid_count: items.filter(s => s.status === 'UNPAID').length
            };
        };

        const vendorSubs = subStats('VENDOR');
        const beauticianSubs = subStats('BEAUTICIAN');
        const totalSubscriptions = vendorSubs.paid_amount + beauticianSubs.paid_amount;
        const unpaidSubscriptions = vendorSubs.unpaid_count + beauticianSubs.unpaid_count;

        // Fetch payouts made
        let payoutQuery = supabase.from('payout_transactions').select('net_paid, entity_type');
        if (!isLifetime) {
            payoutQuery = payoutQuery.eq('month', mt);
        }
        const { data: payoutData, error: payError } = await payoutQuery;

        if (payError) throw payError;

        const calcPaid = (type: string) => payoutData?.filter(p => p.entity_type === type).reduce((sum, i) => sum + (Number(i.net_paid) || 0), 0) || 0;

        const vendorPaid = calcPaid('VENDOR');
        const beauticianPaid = calcPaid('BEAUTICIAN');

        const totalNetPayable = vendorTotals.net_payable + beauticianTotals.net_payable;
        const totalPaidOut = vendorPaid + beauticianPaid;
        const pendingPayouts = totalNetPayable - totalPaidOut;

        res.json({
            success: true,
            data: {
                month: isLifetime ? 'Lifetime' : mt,
                revenue: {
                    gross: totalRevenue,
                    commission: totalCommission,
                    subscriptions: totalSubscriptions
                },
                breakdown: {
                    vendor: {
                        gross: vendorTotals.gross,
                        commission: vendorTotals.commission,
                        subscriptions: vendorSubs.paid_amount,
                        net_payable: vendorTotals.net_payable,
                        paid: vendorPaid,
                        pending: vendorTotals.net_payable - vendorPaid
                    },
                    beautician: {
                        gross: beauticianTotals.gross,
                        commission: beauticianTotals.commission,
                        subscriptions: beauticianSubs.paid_amount,
                        net_payable: beauticianTotals.net_payable,
                        paid: beauticianPaid,
                        pending: beauticianTotals.net_payable - beauticianPaid
                    }
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
// NEW: RECORD PAYOUT
// ==========================================
router.post('/finance/payout', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { entityId, entityType, amount, month, notes } = req.body;

        if (!entityId || !amount || !month) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // 1. Record Transaction
        const { data: payout, error } = await supabase
            .from('payout_transactions')
            .insert([{
                entity_id: entityId,
                entity_type: entityType,
                net_paid: amount,
                month: month,
                notes: notes,
                created_by: req.user?.id,
                status: 'COMPLETED'
            }])
            .select()
            .single();

        if (error) throw error;

        // 2. Notify Payout Recipient (Vendor)
        if (entityType === 'VENDOR') {
            // Get Vendor User ID
            const { data: vendor } = await supabase
                .from('vendor')
                .select('user_id, shopname')
                .eq('id', entityId)
                .single();

            if (vendor && vendor.user_id) {
                await supabase.from('notifications').insert([{
                    user_id: vendor.user_id,
                    title: 'Payout Processed',
                    message: `Admin has processed a payout of $${amount} for ${month}. Check your financial dashboard.`,
                    type: 'PAYOUT'
                }]);
            }
        }

        res.json({ success: true, message: 'Payout recorded successfully', data: payout });

    } catch (error: any) {
        console.error('Payout Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// NEW: ROLLBACK PAYOUT (UNPAY)
// ==========================================
router.post('/finance/unpay', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { entityId, month, entityType } = req.body;

        if (!entityId || !month || !entityType) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const { error } = await supabase
            .from('payout_transactions')
            .delete()
            .eq('entity_id', entityId)
            .eq('entity_type', entityType)
            .eq('month', month);

        if (error) throw error;

        res.json({ success: true, message: 'Payout rolled back successfully' });

    } catch (error: any) {
        console.error('Unpay Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ==========================================
// 2. VENDOR FINANCIAL MANAGMENT (STRICT CASH BASIS)
// ==========================================
// Logic:
// - Source of Truth: 'bookings' (At-Home) & 'vendor_orders' (At-Salon)
// - Condition: Payment is SUCCESS/PAID
// - Metric: Sum of 'total' / 'total_amount'
// - Timing: Based on 'created_at' (Transaction Date), NOT Service Date
// ==========================================
router.get('/finance/vendors', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { month = getCurrentMonth() } = req.query; // YYYY-MM
        const mt = month as string;

        // Date Range (YYYY-MM-01 to NextMonth-01) for robust filtering
        const startDate = `${mt}-01`;
        const nextMonthDate = new Date(`${mt}-01`);
        nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
        const endDate = nextMonthDate.toISOString().split('T')[0]; // Format YYYY-MM-DD

        // 1. Get List of Vendors
        const { data: vendors, error: vError } = await supabase
            .from('vendor')
            .select('id, shopname');

        if (vError) throw vError;

        // 2. Get Audit Data (Fallback/Status)
        const { data: financials } = await supabase
            .from('monthly_earnings_summary')
            .select('*')
            .eq('entity_type', 'VENDOR')
            .eq('month', mt);

        // 3. Get Payouts
        const { data: payouts } = await supabase
            .from('payout_transactions')
            .select('entity_id, net_paid')
            .eq('entity_type', 'VENDOR')
            .eq('month', mt);

        // 4. Get Subscriptions
        const { data: subs } = await supabase
            .from('subscriptions')
            .select('*')
            .eq('entity_type', 'VENDOR')
            .eq('month', mt);

        // =================================================================================
        // CORE FINANCE CALCULATION (LIVE - STRICT CASH BASIS)
        // =================================================================================

        // Source A: At-Salon Orders (vendor_orders)
        // Rule: booking_status IN ('CONFIRMED','PAID','COMPLETED')
        const { data: salonOrders } = await supabase
            .from('vendor_orders')
            .select('vendor_id, total_amount')
            .in('booking_status', ['CONFIRMED', 'PAID', 'COMPLETED'])
            .gte('created_at', startDate)
            .lt('created_at', endDate);

        // Source B: At-Home Bookings (bookings)
        // Rule: payment_status = SUCCESS (or legacy status COMPLETED fallback if handled in trigger)
        const { data: appBookings } = await supabase
            .from('bookings')
            .select('vendorId, vendor_id, total') // Handle camel/snake case
            .eq('payment_status', 'SUCCESS')
            .gte('created_at', startDate)
            .lt('created_at', endDate);

        // C. Counts (from COMPLETED only)
        const { data: salonCounts } = await supabase
            .from('vendor_orders')
            .select('vendor_id')
            .eq('booking_status', 'COMPLETED')
            .gte('created_at', startDate)
            .lt('created_at', endDate);

        const { data: appCounts } = await supabase
            .from('bookings')
            .select('vendorId, vendor_id')
            .eq('status', 'COMPLETED')
            .gte('created_at', startDate)
            .lt('created_at', endDate);


        // Aggregation
        const result = vendors?.map(v => {
            const vid = v.id;

            // A. Money (Live)
            const salonRevenue = salonOrders
                ?.filter(o => o.vendor_id === vid)
                .reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0) || 0;

            const appRevenue = appBookings
                ?.filter((b: any) => (b.vendorId === vid || b.vendor_id === vid))
                .reduce((sum, b) => sum + (Number(b.total) || 0), 0) || 0;

            const totalGross = salonRevenue + appRevenue;

            // B. Counts (Live)
            const salonCount = salonCounts?.filter(c => c.vendor_id === vid).length || 0;
            const appCount = appCounts?.filter((c: any) => (c.vendorId === vid || c.vendor_id === vid)).length || 0;
            const totalServices = salonCount + appCount;

            // C. Financials
            const gross = totalGross;
            const commission = gross * 0.15;
            const netPayable = gross - commission;

            const totalPaid = payouts?.filter(p => p.entity_id === vid).reduce((sum, p) => sum + (Number(p.net_paid) || 0), 0) || 0;
            const balance = netPayable - totalPaid;
            const sub = subs?.find(s => s.entity_id === vid);

            return {
                id: vid,
                name: v.shopname,
                type: 'VENDOR',
                financials: {
                    total_services: totalServices,
                    gross: gross,
                    commission: commission,
                    net_payable: netPayable,
                    paid: totalPaid,
                    balance: balance
                },
                subscription: {
                    status: sub?.status || 'UNPAID',
                    amount: sub?.amount || 10
                },
                status: {
                    is_active: true // Simplified for now
                }
            };
        });

        res.json({ success: true, data: result });

    } catch (error: any) {
        console.error("Finance Vendor Error:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// 3. BEAUTICIAN FINANCIAL MANAGMENT (STRICT CASH BASIS)
// ==========================================
router.get('/finance/beauticians', requireAuth, requireRole(['ADMIN']), async (req: AuthenticatedRequest, res) => {
    try {
        const { month = getCurrentMonth() } = req.query;
        const mt = month as string;

        // Date Range
        const startDate = `${mt}-01`;
        const nextMonthDate = new Date(`${mt}-01`);
        nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
        const endDate = nextMonthDate.toISOString().split('T')[0];

        // 1. Get all Beauticians
        const { data: beauticians, error: bError } = await supabase
            .from('beauticians')
            .select('id, name');

        if (bError) throw bError;

        // 2. Get Audit Data (Fallback)
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

        // 4. Get Payouts
        const { data: payouts } = await supabase
            .from('payout_transactions')
            .select('entity_id, net_paid')
            .eq('entity_type', 'BEAUTICIAN')
            .eq('month', mt);

        // =================================================================================
        // CORE FINANCE CALCULATION (LIVE - STRICT CASH BASIS)
        // =================================================================================

        // Source: athome_bookings (At-Home) strictly
        // Rule: payment_status = SUCCESS (or PAID)
        // Link: assigned_beautician_id
        const { data: liveBookings } = await supabase
            .from('athome_bookings')
            .select('assigned_beautician_id, total_amount')
            .eq('payment_status', 'SUCCESS')
            .gte('created_at', startDate)
            .lt('created_at', endDate);

        // Service Counts (Completed only)
        const { data: completedStats } = await supabase
            .from('athome_bookings')
            .select('assigned_beautician_id')
            .eq('status', 'COMPLETED')
            .gte('created_at', startDate)
            .lt('created_at', endDate);

        // Lifetime Counts (for display consistency)
        const { data: lifetimeStats } = await supabase
            .from('athome_bookings')
            .select('assigned_beautician_id')
            .eq('status', 'COMPLETED');


        const result = beauticians?.map(b => {
            const bid = b.id;
            const name = b.name || 'Unknown';

            // A. Money (Live)
            const monthlyRevenue = liveBookings
                ?.filter((bk: any) => bk.assigned_beautician_id === bid)
                .reduce((sum, bk) => sum + (Number(bk.total_amount) || 0), 0) || 0;

            // B. Counts
            const monthlyCount = completedStats
                ?.filter((bk: any) => bk.assigned_beautician_id === bid).length || 0;

            const lifetimeCount = lifetimeStats
                ?.filter((bk: any) => bk.assigned_beautician_id === bid).length || 0;

            // C. Financials
            const gross = monthlyRevenue;
            const commission = gross * 0.15;
            const netPayable = gross - commission;

            const totalPaid = payouts?.filter(p => p.entity_id === bid).reduce((sum, p) => sum + (Number(p.net_paid) || 0), 0) || 0;
            const balance = netPayable - totalPaid;
            const sub = subs?.find(s => s.entity_id === bid);

            return {
                id: bid,
                name: name,
                type: 'BEAUTICIAN',
                financials: {
                    total_services: lifetimeCount, // Lifetime count for display
                    monthly_services_count: monthlyCount, // Available if needed
                    gross: gross,
                    commission: commission,
                    net_payable: netPayable,
                    paid: totalPaid,
                    balance: balance
                },
                subscription: {
                    status: sub?.status || 'UNPAID',
                    amount: sub?.amount || 10
                },
                status: { is_active: true }
            };
        });

        res.json({ success: true, data: result });

    } catch (error: any) {
        console.error("Finance Beautician Error:", error);
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
