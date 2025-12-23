import 'dotenv/config';
import nodemailer from 'nodemailer';

async function diagnoseSMTP() {
    console.log('--- SMTP Diagnostic ---');
    console.log('Timestamp:', new Date().toISOString());

    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = process.env.SMTP_PORT || '587';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    console.log('SMTP_HOST:', host);
    console.log('SMTP_PORT:', port);
    console.log('SMTP_USER:', user ? `SET (starts with ${user.substring(0, 2)}...)` : 'NOT SET');
    console.log('SMTP_PASS:', pass ? `SET (length: ${pass.length})` : 'NOT SET');

    if (!user || !pass) {
        console.error('❌ Critical: SMTP_USER or SMTP_PASS is missing.');
        return;
    }

    if (host.includes('gmail.com') && pass.length !== 16) {
        console.warn('⚠️ Warning: Using Gmail but SMTP_PASS length is not 16. Gmail App Passwords should be 16 characters.');
    }

    const transporter = nodemailer.createTransport({
        host,
        port: parseInt(port),
        secure: port === '465',
        auth: { user, pass }
    });

    console.log('Attempting to verify transporter...');
    try {
        await transporter.verify();
        console.log('✅ SMTP Connection verified successfully!');
    } catch (error: any) {
        console.error('❌ SMTP Verification Failed:');
        console.error('Message:', error.message);
        if (error.response) console.error('Response:', error.response);
        if (error.code) console.error('Code:', error.code);
    }
}

diagnoseSMTP().catch(console.error);
