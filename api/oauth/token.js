export default async function handler(request, response) {
    if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        return response.status(405).json({
            error: 'method_not_allowed',
            error_description: 'Only POST is supported.',
        });
    }

    const appId = process.env.CLIENT_ID || process.env.APP_ID || process.env.NEXT_PUBLIC_APP_ID;
    if (!appId) {
        return response.status(500).json({
            error: 'server_configuration_error',
            error_description: 'Deriv OAuth App ID is not configured in Vercel.',
        });
    }

    try {
        const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body || {};
        const grantType = body.grant_type;

        if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
            return response.status(400).json({
                error: 'invalid_request',
                error_description: 'Unsupported OAuth grant type.',
            });
        }

        const form = new URLSearchParams({
            grant_type: grantType,
            client_id: String(appId),
        });

        if (grantType === 'authorization_code') {
            if (!body.code || !body.code_verifier || !body.redirect_uri) {
                return response.status(400).json({
                    error: 'invalid_request',
                    error_description: 'code, code_verifier and redirect_uri are required.',
                });
            }
            form.set('code', String(body.code));
            form.set('code_verifier', String(body.code_verifier));
            form.set('redirect_uri', String(body.redirect_uri));
        } else {
            if (!body.refresh_token) {
                return response.status(400).json({
                    error: 'invalid_request',
                    error_description: 'refresh_token is required.',
                });
            }
            form.set('refresh_token', String(body.refresh_token));
        }

        const upstream = await fetch('https://auth.deriv.com/oauth2/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body: form.toString(),
        });

        const text = await upstream.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = {
                error: 'token_exchange_failed',
                error_description: text || `Deriv OAuth returned HTTP ${upstream.status}.`,
            };
        }

        // Never log or expose authorization codes, refresh tokens, or access tokens.
        return response.status(upstream.status).json(data);
    } catch (error) {
        return response.status(502).json({
            error: 'network_error',
            error_description: error instanceof Error ? error.message : 'Unable to reach Deriv OAuth.',
        });
    }
}
