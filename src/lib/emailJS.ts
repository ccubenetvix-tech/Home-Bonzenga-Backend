import { sendVendorVerificationEmail } from './emailService';

interface EmailParams {
    to_email: string;
    user_name: string;
    verify_link: string;
}

/**
 * Bridge function to maintain compatibility with the frontend-style EmailJS calls
 * but using the backend's existing Nodemailer service.
 */
export const sendVerificationEmail = async (params: EmailParams) => {
    try {
        // Map params to what sendVendorVerificationEmail expects
        // Note: auth.ts calls it with to_email, user_name, verify_link
        return await sendVendorVerificationEmail({
            email: params.to_email,
            ownerName: params.user_name,
            shopName: 'Home Bonzenga', // Default fallback since and auth.ts doesn't always pass it here
            verifyUrl: params.verify_link
        });
    } catch (error) {
        console.error('❌ Error in sendVerificationEmail bridge:', error);
        return false;
    }
};
