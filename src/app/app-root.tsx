import { lazy, Suspense } from 'react';
import { observer } from 'mobx-react-lite';
import ErrorBoundary from '@/components/error-component/error-boundary';
import ErrorComponent from '@/components/error-component/error-component';
import ChunkLoader from '@/components/loader/chunk-loader';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import './app-root.scss';

const AppContent = lazy(() => import('./app-content'));

const AppRootLoader = () => <ChunkLoader message={localize('Loading...')} />;

const ErrorComponentWrapper = observer(() => {
    const { common } = useStore();
    if (!common.error) return null;
    return (
        <ErrorComponent
            header={common.error?.header}
            message={common.error?.message}
            redirect_label={common.error?.redirect_label}
            redirectOnClick={common.error?.redirectOnClick}
            should_clear_error_on_click={common.error?.should_clear_error_on_click}
            setError={common.setError}
            redirect_to={common.error?.redirect_to}
            should_redirect={common.error?.should_redirect}
        />
    );
});

/**
 * The root application never initializes Deriv.
 *
 * Deriv authentication/trading connections are deliberately lazy and must be
 * started by the login flow. This prevents a public visitor from being blocked
 * by a WebSocket/API outage before the UI can render.
 */
const AppRoot = () => {
    const store = useStore();
    if (!store) return <AppRootLoader />;

    return (
        <Suspense fallback={<AppRootLoader />}>
            <ErrorBoundary root_store={store}>
                <ErrorComponentWrapper />
                <AppContent />
            </ErrorBoundary>
        </Suspense>
    );
};

export default AppRoot;
