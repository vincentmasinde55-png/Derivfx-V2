import { lazy, Suspense, useEffect, useRef, type ReactNode } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import { StoreProvider } from '@/hooks/useStore';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
import { DerivWSAccountsService } from '@/services/derivws-accounts.service';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { initializeI18n, localize, TranslationProvider } from '@deriv-com/translations';
import CoreStoreProvider from './CoreStoreProvider';
import './app-root.scss';

const Layout = lazy(() => import('../components/layout'));
const AppRoot = lazy(() => import('./app-root'));
const i18nInstance = initializeI18n({ cdnUrl: '' });

const LanguageHandler = ({ children }: { children: ReactNode }) => {
    useLanguageFromURL();
    return <>{children}</>;
};

const router = createBrowserRouter(
    createRoutesFromElements(
        <Route path='/' element={
            <Suspense fallback={<ChunkLoader message={localize('Please wait while we connect to the server...')} />}>
                <TranslationProvider defaultLang='EN' i18nInstance={i18nInstance}>
                    <LanguageHandler>
                        <StoreProvider>
                            <LocalStorageSyncWrapper>
                                <RoutePromptDialog />
                                <CoreStoreProvider>
                                    <Layout />
                                </CoreStoreProvider>
                            </LocalStorageSyncWrapper>
                        </StoreProvider>
                    </LanguageHandler>
                </TranslationProvider>
            </Suspense>
        }>
            <Route index element={<AppRoot />} />
        </Route>
    )
);

function App() {
    const { isProcessing, isValid, params, error, cleanupURL } = useOAuthCallback();
    useAccountSwitching();
    // React StrictMode can run effects more than once. An OAuth authorization
    // code is single-use and the PKCE verifier is cleared after the first
    // exchange, so guard this callback by code to prevent a second exchange
    // from producing a misleading "PKCE verifier is missing" dialog.
    const processedCodeRef = useRef<string | null>(null);

    useEffect(() => {
        if (isProcessing || !isValid || !params.code) return;
        if (processedCodeRef.current === params.code) return;
        processedCodeRef.current = params.code;

        let cancelled = false;

        const finishOAuth = async () => {
            try {
                const response = await OAuthTokenExchangeService.exchangeCodeForToken(params.code!);
                if (cancelled) return;

                if (!response.access_token) {
                    processedCodeRef.current = null;
                    console.error('❌ Deriv OAuth token exchange failed:', response.error_description || response.error);
                    return;
                }

                const accounts = await DerivWSAccountsService.fetchAccountsList(response.access_token);
                if (cancelled) return;
                if (!accounts.length) throw new Error('Deriv OAuth succeeded, but no trading accounts were returned.');

                const activeAccount =
                    accounts.find(account => account.account_type === 'real' && account.status === 'active') ||
                    accounts.find(account => account.status === 'active') ||
                    accounts[0];

                localStorage.setItem('active_loginid', activeAccount.account_id);
                localStorage.setItem('account_type', activeAccount.account_type === 'demo' ? 'demo' : 'real');

                await api_base.init(true);
                if (cancelled) return;

                cleanupURL();
                window.dispatchEvent(new CustomEvent('derivfx-authenticated', {
                    detail: { accounts, activeAccount: activeAccount.account_id },
                }));
            } catch (oauthError) {
                if (!cancelled) {
                    // A successful token exchange/account load means this is
                    // not an OAuth login failure; only report the actual error.
                    console.error('❌ Deriv account initialization failed:', oauthError);
                    window.dispatchEvent(new CustomEvent('derivfx-auth-error', {
                        detail: oauthError instanceof Error ? oauthError.message : 'Unable to initialize Deriv account.',
                    }));
                }
            }
        };

        void finishOAuth();
        return () => {
            cancelled = true;
        };
    }, [isProcessing, isValid, params.code, cleanupURL]);

    useEffect(() => {
        if (error) console.error('Deriv OAuth callback error:', error);
    }, [error]);

    return <RouterProvider router={router} />;
}

export default App;
