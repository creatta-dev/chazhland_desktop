// Крутилка на кнопках: белое кольцо с прозрачным хвостом. Раньше была скопирована
// в AuthScreen / Composer / SettingsModal — отличалась только размером.
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        border: '2.5px solid rgba(255,255,255,.4)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'spin .7s linear infinite',
      }}
    />
  )
}
