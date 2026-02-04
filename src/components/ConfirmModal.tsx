import { useEffect, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import './ConfirmModal.css';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  isOpen,
  title,
  message,
  confirmText,
  cancelText,
  type = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useSettings();
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      confirmBtnRef.current?.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className={`confirm-modal ${type}`} onClick={(e) => e.stopPropagation()}>
        <button className="confirm-close" onClick={onCancel}>
          <X size={18} />
        </button>

        <div className="confirm-icon">
          <AlertTriangle size={32} />
        </div>

        <div className="confirm-content">
          {title && <h3 className="confirm-title">{title}</h3>}
          <p className="confirm-message">{message}</p>
        </div>

        <div className="confirm-actions">
          <button className="confirm-btn cancel" onClick={onCancel}>
            {cancelText || t('common.cancel')}
          </button>
          <button
            ref={confirmBtnRef}
            className={`confirm-btn confirm ${type}`}
            onClick={onConfirm}
          >
            {confirmText || t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
