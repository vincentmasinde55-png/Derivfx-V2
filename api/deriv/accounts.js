export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({ error: 'method_not_allowed' });
    }

    const appId = process.env.APP_ID || process.env.CLIENT_ID || process.env.NEXT_PUBLIC_APP_ID;
    const accessToken = request.body?.access_token;
    if (!appId || !accessToken) {
        return response.status(400).json({ error: 'invalid_request', error_description: 'Missing OAuth access token or App ID.' });
    }

    try {
        const upstream = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Deriv-App-ID': String(appId),
                Accept: 'application/json',
            },
        });
        const text = await upstream.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { error: 'upstream_error', error_description: text }; }
        return response.status(upstream.status).json(data);
    } catch (error) {
        return response.status(502).json({ error: 'network_error', error_description: error instanceof Error ? error.message : 'Unable to reach Deriv.' });
    }
}
