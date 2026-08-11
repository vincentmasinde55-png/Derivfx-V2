import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { createBrowserRouter, createRoutesFromElements, Route, RouterProvider } from 'react-router-dom';
import ChunkLoader from '@/components/loader/chunk-loader';
import LocalStorageSyncWrapper from '@/components/localStorage-sync-wrapper';
import RoutePromptDialog from '@/components/route-prompt-dialog';
import { useAccountSwitching } from '@/hooks/useAccountSwitching';
import { useLanguageFromURL } from '@/hooks/useLanguageFromURL';
import { useOAuthCallback } from '@/hooks/useOAuthCallback';
import { StoreProvider } from '@/hooks/useStore';
import { OAuthTokenExchangeService } from '@/services/oauth-token-exchange.service';
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
        <Route
            path='/'
            element={
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
            }
        >
            <Route index element={<AppRoot />} />
        </Route>
    )
);

function App() {
    const { isProcessing, isValid, params, error, cleanupURL } = useOAuthCallback();
    useAccountSwitching();

    useEffect(() => {
        if (isProcessing || !isValid || !params.code) return;

        let cancelled = false;

        const finishOAuth = async () => {
            try {
                const response = await OAuthTokenExchangeService.exchangeCodeForToken(params.code!);
                if (cancelled) return;

                if (!response.access_token) {
                    console.error('❌ Deriv OAuth token exchange failed:', response.error_description || response.error);
                    return;
                }

                cleanupURL();
                window.dispatchEvent(new Event('derivfx-authenticated'));
            } catch (oauthError) {
                if (!cancelled) console.error('❌ Deriv OAuth callback failed:', oauthError);
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
