const http = require('http');

function request(path) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: path,
            method: 'GET',
            headers: { 'Authorization': 'Bearer static-admin-token' }
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({}); // Ignore parse errors
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function verify() {
    try {
        console.log("Fetching vendors list...");
        const list = await request('/api/admin/vendors');

        if (!list.vendors || list.vendors.length === 0) {
            console.error("No vendors found.");
            return;
        }

        console.log(`Scanning ${list.vendors.length} vendors for services...`);

        let found = false;
        for (const vendor of list.vendors) {
            const details = await request(`/api/admin/vendors/${vendor.id}`);
            if (details.services && details.services.length > 0) {
                console.log(`✅ FOUND SERVICES for Vendor: ${vendor.shopName} (ID: ${vendor.id})`);
                console.log(`Count: ${details.services.length}`);
                console.log("First Service:", JSON.stringify(details.services[0], null, 2));
                found = true;
                break;
            }
        }

        if (!found) {
            console.log("❌ No services found for ANY vendor.");
        }

    } catch (error) {
        console.error("Verification failed:", error);
    }
}

verify();
