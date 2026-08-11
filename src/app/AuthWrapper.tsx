// Removed unused React import - React 17+ JSX transform doesn't require it
import { SpeedInsights } from '@vercel/speed-insights/react';
import App from './App';

export const AuthWrapper = () => {
    return (
        <>
            <App />
            <SpeedInsights />
        </>
    );
};
