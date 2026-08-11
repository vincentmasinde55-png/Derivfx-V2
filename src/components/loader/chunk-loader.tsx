import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading } = blockly_store;

    return is_loading ? (
        <div
            className='bot__loading derivfx-loader'
            data-testid='blockly-loader'
            style={{
                background: 'radial-gradient(circle at 50% 35%, #102a56 0%, #071426 42%, #020711 100%)',
                color: '#fff',
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            <img src='/deriv-logo.svg' alt='DerivFX' style={{ width: 'min(240px, 62vw)', maxWidth: 240, height: 'auto', marginBottom: 22 }} />
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', height: 30 }}>
                {[0, 1, 2].map(index => (
                    <span
                        key={index}
                        style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: index === 1 ? '#ff3b43' : '#16c8ff',
                            animation: `derivfx-pulse 1s ease-in-out ${index * 0.16}s infinite`,
                        }}
                    />
                ))}
            </div>
            <div style={{ marginTop: 14, fontWeight: 600, color: 'rgba(255,255,255,.86)' }}>Loading DerivFX Bot Builder...</div>
            <style>{`@keyframes derivfx-pulse{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-7px);opacity:1}}`}</style>
        </div>
    ) : null;
});

export default BlocklyLoading;
