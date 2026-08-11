import React from 'react';

export default function ChunkLoader({ message }: { message: string }) {
    return (
        <div className='app-root' style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#020817', gap: 18 }}>
            <img src='/deriv-logo.svg' alt='DerivFX' style={{ width: 'min(320px, 72vw)', height: 'auto', display: 'block' }} />
            <div aria-label={message} style={{ width: 34, height: 34, border: '4px solid rgba(255,255,255,.2)', borderTopColor: '#16c8ff', borderRightColor: '#ff3b43', borderRadius: '50%', animation: 'derivfx-spin .8s linear infinite' }} />
            <div className='load-message' style={{ color: '#fff', fontWeight: 600 }}>{message}</div>
            <style>{`@keyframes derivfx-spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
