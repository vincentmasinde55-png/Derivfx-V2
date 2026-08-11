import React from 'react';

export default function ChunkLoader({ message }: { message: string }) {
    return (
        <div
            className='app-root derivfx-loader'
            style={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'radial-gradient(circle at 50% 35%, #102a56 0%, #071426 42%, #020711 100%)',
                color: '#fff',
                gap: 18,
                padding: 24,
                position: 'relative',
                overflow: 'hidden',
            }}
        >
            <div style={{ position: 'absolute', width: 280, height: 280, borderRadius: '50%', background: 'rgba(0, 214, 255, .08)', filter: 'blur(8px)', top: '18%', left: '50%', transform: 'translate(-50%, -50%)' }} />
            <img src='/deriv-logo.svg' alt='DerivFX' style={{ width: 'min(250px, 68vw)', height: 'auto', display: 'block', position: 'relative' }} />
            <div aria-label={message} style={{ display: 'flex', gap: 7, alignItems: 'center', height: 30 }}>
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
            <div className='load-message' style={{ color: 'rgba(255,255,255,.86)', fontWeight: 600, fontSize: 14, position: 'relative' }}>{message}</div>
            <style>{`@keyframes derivfx-pulse{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-7px);opacity:1}}`}</style>
        </div>
    );
}
