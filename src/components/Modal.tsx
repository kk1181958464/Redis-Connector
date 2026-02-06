import { useEffect, useState, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import './Modal.css';

interface ModalState {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEscape?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  storageKey?: string; // 用于持久化位置和大小
}

// 从 localStorage 读取弹窗状态
function loadModalState(key: string): ModalState | null {
  try {
    const stored = localStorage.getItem(`modal-state-${key}`);
    if (stored) {
      const state = JSON.parse(stored) as ModalState;
      // 验证状态有效性
      if (typeof state.x === 'number' && typeof state.y === 'number' &&
          typeof state.width === 'number' && typeof state.height === 'number') {
        return state;
      }
    }
  } catch (e) {
    console.warn('Failed to load modal state:', e);
  }
  return null;
}

// 保存弹窗状态到 localStorage
function saveModalState(key: string, state: ModalState): void {
  try {
    localStorage.setItem(`modal-state-${key}`, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save modal state:', e);
  }
}

function Modal({
  isOpen,
  onClose,
  children,
  title,
  className = '',
  width = 500,
  height,
  minWidth = 300,
  minHeight = 200,
  showCloseButton = true,
  closeOnOverlayClick = false,
  closeOnEscape = true,
  draggable = true,
  resizable = true,
  storageKey,
}: ModalProps) {
  const [shouldRender, setShouldRender] = useState(false);
  const [animationState, setAnimationState] = useState<'entering' | 'entered' | 'exiting' | 'exited'>('exited');
  const overlayRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);

  // 调整大小状态
  const [isResizing, setIsResizing] = useState(false);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number; direction: string; startPosX: number; startPosY: number } | null>(null);

  // 标记是否已从存储恢复状态
  const restoredRef = useRef(false);
  // 用于保存关闭前的状态
  const lastStateRef = useRef<{ position: { x: number; y: number } | null; size: { width: number; height: number } | null }>({
    position: null,
    size: null,
  });

  // 实时更新 lastStateRef（用于关闭时保存）
  useEffect(() => {
    lastStateRef.current = { position, size };
  }, [position, size]);

  // 打开时恢复或初始化位置和大小
  useEffect(() => {
    if (isOpen) {
      const initialWidth = typeof width === 'number' ? width : 500;
      const initialHeight = typeof height === 'number' ? height : 400;

      // 尝试从 localStorage 恢复状态
      if (storageKey) {
        const savedState = loadModalState(storageKey);
        if (savedState) {
          // 验证位置在屏幕范围内
          const maxX = window.innerWidth - savedState.width;
          const maxY = window.innerHeight - savedState.height;
          const validX = Math.max(0, Math.min(savedState.x, maxX));
          const validY = Math.max(0, Math.min(savedState.y, maxY));

          setPosition({ x: validX, y: validY });
          setSize({
            width: Math.max(minWidth, savedState.width),
            height: Math.max(minHeight, savedState.height)
          });
          restoredRef.current = true;
          return;
        }
      }

      // 无存储状态，使用默认值
      setPosition(null);
      setSize({ width: initialWidth, height: initialHeight });
      restoredRef.current = false;
    } else {
      // 关闭时保存状态
      if (storageKey && lastStateRef.current.size) {
        const currentSize = lastStateRef.current.size;
        const currentPosition = lastStateRef.current.position;
        const currentX = currentPosition?.x ?? (window.innerWidth - currentSize.width) / 2;
        const currentY = currentPosition?.y ?? (window.innerHeight - currentSize.height) / 2;

        saveModalState(storageKey, {
          x: currentX,
          y: currentY,
          width: currentSize.width,
          height: currentSize.height,
        });
      }
    }
  }, [isOpen, width, height, storageKey, minWidth, minHeight]);

  // 处理打开/关闭
  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimationState('entering');
          setTimeout(() => setAnimationState('entered'), 250);
        });
      });
    } else if (shouldRender) {
      setAnimationState('exiting');
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

  // 拖拽开始
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (!draggable) return;
    e.preventDefault();

    const modal = modalRef.current;
    if (!modal) return;

    const rect = modal.getBoundingClientRect();
    // 使用 DOM 实际位置，确保一致性
    const currentX = position?.x ?? rect.left;
    const currentY = position?.y ?? rect.top;

    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: currentX,
      posY: currentY,
    };
    setIsDragging(true);
  }, [draggable, position]);

  // 拖拽移动
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current || !modalRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.x;
      const deltaY = e.clientY - dragStartRef.current.y;

      let newX = dragStartRef.current.posX + deltaX;
      let newY = dragStartRef.current.posY + deltaY;

      // 边界限制：弹窗不能移出窗口
      const modalWidth = modalRef.current.offsetWidth;
      const modalHeight = modalRef.current.offsetHeight;

      // X 轴：完全不能移出左右边界
      newX = Math.max(0, Math.min(newX, window.innerWidth - modalWidth));
      // Y 轴：完全不能移出上下边界
      newY = Math.max(0, Math.min(newY, window.innerHeight - modalHeight));

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // 调整大小开始
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();

    const modal = modalRef.current;
    if (!modal) return;

    const rect = modal.getBoundingClientRect();

    // 记录初始位置（如果没有 position，使用当前 DOM 位置）
    const startX = position?.x ?? rect.left;
    const startY = position?.y ?? rect.top;

    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
      direction,
      startPosX: startX,
      startPosY: startY,
    };
    setIsResizing(true);
  }, [resizable, position]);

  // 调整大小移动
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeStartRef.current || !modalRef.current) return;

      const { x, y, width: startWidth, height: startHeight, direction, startPosX, startPosY } = resizeStartRef.current;
      const deltaX = e.clientX - x;
      const deltaY = e.clientY - y;

      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startPosX;
      let newY = startPosY;

      // 根据方向调整大小
      if (direction.includes('e')) {
        newWidth = Math.max(minWidth, startWidth + deltaX);
      }
      if (direction.includes('w')) {
        const widthDelta = Math.min(deltaX, startWidth - minWidth);
        newWidth = startWidth - widthDelta;
        newX = startPosX + widthDelta;
      }
      if (direction.includes('s')) {
        newHeight = Math.max(minHeight, startHeight + deltaY);
      }
      if (direction.includes('n')) {
        const heightDelta = Math.min(deltaY, startHeight - minHeight);
        newHeight = startHeight - heightDelta;
        newY = startPosY + heightDelta;
      }

      // 边界限制：弹窗不能移出窗口
      newX = Math.max(0, Math.min(newX, window.innerWidth - newWidth));
      newY = Math.max(0, Math.min(newY, window.innerHeight - newHeight));

      setSize({ width: newWidth, height: newHeight });
      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, position, minWidth, minHeight]);

  // 点击遮罩关闭
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (closeOnOverlayClick && e.target === overlayRef.current) {
      onClose();
    }
  }, [closeOnOverlayClick, onClose]);

  if (!shouldRender) return null;

  const isAnimating = animationState === 'entering' || animationState === 'exiting';
  const isVisible = animationState === 'entering' || animationState === 'entered';

  const modalStyle: React.CSSProperties = {
    width: size?.width ?? (typeof width === 'number' ? width : undefined),
    height: size?.height ?? (typeof height === 'number' ? height : undefined),
    ...(position ? {
      position: 'absolute',
      left: position.x,
      top: position.y,
      transform: 'none',
    } : {}),
  };

  return (
    <div
      ref={overlayRef}
      className={`modal-overlay-base ${isVisible ? 'visible' : ''} ${isAnimating ? 'animating' : ''} ${isDragging || isResizing ? 'no-transition' : ''}`}
      onClick={handleOverlayClick}
    >
      <div
        ref={modalRef}
        className={`modal-content-base ${className} ${isVisible ? 'visible' : ''} ${isDragging ? 'dragging' : ''} ${isResizing ? 'resizing' : ''}`}
        style={modalStyle}
      >
        {(title || showCloseButton) && (
          <div
            className={`modal-header-base ${draggable ? 'draggable' : ''}`}
            onMouseDown={handleDragStart}
          >
            {title && <div className="modal-title-base">{title}</div>}
            {showCloseButton && (
              <button className="modal-close-base" onClick={onClose} onMouseDown={e => e.stopPropagation()}>
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="modal-body-base">
          {children}
        </div>

        {/* 调整大小手柄 */}
        {resizable && (
          <>
            <div className="resize-handle resize-n" onMouseDown={e => handleResizeStart(e, 'n')} />
            <div className="resize-handle resize-s" onMouseDown={e => handleResizeStart(e, 's')} />
            <div className="resize-handle resize-e" onMouseDown={e => handleResizeStart(e, 'e')} />
            <div className="resize-handle resize-w" onMouseDown={e => handleResizeStart(e, 'w')} />
            <div className="resize-handle resize-ne" onMouseDown={e => handleResizeStart(e, 'ne')} />
            <div className="resize-handle resize-nw" onMouseDown={e => handleResizeStart(e, 'nw')} />
            <div className="resize-handle resize-se" onMouseDown={e => handleResizeStart(e, 'se')} />
            <div className="resize-handle resize-sw" onMouseDown={e => handleResizeStart(e, 'sw')} />
          </>
        )}
      </div>
    </div>
  );
}

export default Modal;
