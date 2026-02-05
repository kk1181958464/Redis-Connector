import { useEffect, useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
  width?: number | string;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
}

function Modal({
  isOpen,
  onClose,
  children,
  title,
  className = '',
  width = 500,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEscape = true,
}: ModalProps) {
  const [shouldRender, setShouldRender] = useState(false);
  const [animationState, setAnimationState] = useState<'entering' | 'entered' | 'exiting' | 'exited'>('exited');
  const overlayRef = useRef<HTMLDivElement>(null);

  // 处理打开/关闭
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      // 使用 requestAnimationFrame 确保 DOM 已渲染
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimationState('entering');
          // 动画完成后设置为 entered
          setTimeout(() => setAnimationState('entered'), 250);
        });
      });
    } else if (shouldRender) {
      setAnimationState('exiting');
      // 退场动画完成后卸载
      const timer = setTimeout(() => {
        setAnimationState('exited');
        setShouldRender(false);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // ESC 关闭
  useEffect(() => {
    if (!closeOnEscape || !shouldRender) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEscape, shouldRender, onClose]);

  // 点击遮罩关闭
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === overlayRef.current) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  if (!shouldRender) return null;

  const isAnimating = animationState === 'entering' || animationState === 'exiting';
  const isVisible = animationState === 'entering' || animationState === 'entered';

  return (
    <div
      ref={overlayRef}
      className={`modal-overlay-base ${isVisible ? 'visible' : ''} ${isAnimating ? 'animating' : ''}`}
      onClick={handleOverlayClick}
    >
      <div
        className={`modal-content-base ${className} ${isVisible ? 'visible' : ''}`}
        style={{ width: typeof width === 'number' ? `${width}px` : width }}
      >
        {(title || showCloseButton) && (
          <div className="modal-header-base">
            {title && <div className="modal-title-base">{title}</div>}
            {showCloseButton && (
              <button className="modal-close-base" onClick={onClose}>
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body-base">
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;
