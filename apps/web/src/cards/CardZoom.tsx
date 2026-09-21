/** Full-screen card image, dismissed by a tap: the touch stand-in for hovering. */
export function CardZoom({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" onClick={onClose} onPointerDown={onClose} role="presentation">
      <img src={src} alt="" className="max-h-full max-w-full rounded-[4.5%] shadow-2xl" draggable={false} />
    </div>
  );
}
