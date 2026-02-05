import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import Modal from './Modal';
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
      setTimeout(() => confirmBtnRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onConfirm]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      width={380}
      showCloseButton={false}
      className="confirm-modal-wrapper"
    >
      <div className={`confirm-modal ${type}`}>
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
    </Modal>
  );
}

export default ConfirmModal;
