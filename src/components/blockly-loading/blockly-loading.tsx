import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';

const BlocklyLoading = observer(() => {
    const { blockly_store } = useStore();
    const { is_loading } = blockly_store;

    return is_loading ? (
        <div className='bot__loading' data-testid='blockly-loader' style={{ background: '#020817', color: '#fff' }}>
            <img src='/deriv-logo.svg' alt='DerivFX' style={{ width: 'min(280px, 65vw)', maxWidth: 280, height: 'auto', marginBottom: 18 }} />
            <div style={{ width: 32, height: 32, border: '4px solid rgba(255,255,255,.2)', borderTopColor: '#16c8ff', borderRightColor: '#ff3b43', borderRadius: '50%', animation: 'derivfx-blockly-spin .8s linear infinite' }} />
            <div style={{ marginTop: 14, fontWeight: 600 }}>Loading DerivFX Bot Builder...</div>
            <style>{`@keyframes derivfx-blockly-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    ) : null;
});

export default BlocklyLoading;
