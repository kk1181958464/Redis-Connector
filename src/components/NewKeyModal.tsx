import { useState, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import Modal from './Modal';
import './NewKeyModal.css';

type KeyType = 'string' | 'hash' | 'list' | 'set' | 'zset';

interface NewKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecute: (command: string) => Promise<any>;
  onSuccess: () => void;
}

interface HashField {
  field: string;
  value: string;
}

interface ZSetMember {
  member: string;
  score: string;
}

function NewKeyModal({ isOpen, onClose, onExecute, onSuccess }: NewKeyModalProps) {
  const { t, settings } = useSettings();
  const [keyName, setKeyName] = useState('');
  const [keyType, setKeyType] = useState<KeyType>('string');
  const [ttl, setTtl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // String 类型
  const [stringValue, setStringValue] = useState('');

  // Hash 类型
  const [hashFields, setHashFields] = useState<HashField[]>([{ field: '', value: '' }]);

  // List/Set 类型
  const [listItems, setListItems] = useState<string[]>(['']);

  // ZSet 类型
  const [zsetMembers, setZsetMembers] = useState<ZSetMember[]>([{ member: '', score: '0' }]);

  // 重置表单
  useEffect(() => {
    if (isOpen) {
      setKeyName('');
      setKeyType('string');
      setTtl('');
      setStringValue('');
      setHashFields([{ field: '', value: '' }]);
      setListItems(['']);
      setZsetMembers([{ member: '', score: '0' }]);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName.trim()) {
      setError(settings.language === 'zh-CN' ? 'Key 名称不能为空' : 'Key name is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const key = keyName.trim();

      // 根据类型创建 Key
      if (keyType === 'string') {
        if (!stringValue) {
          setError(settings.language === 'zh-CN' ? '值不能为空' : 'Value is required');
          setLoading(false);
          return;
        }
        const result = await onExecute(`SET "${key}" "${stringValue.replace(/"/g, '\\"')}"`);
        if (!result?.success) throw new Error(result?.error);
      } else if (keyType === 'hash') {
        const validFields = hashFields.filter(f => f.field.trim());
        if (validFields.length === 0) {
          setError(settings.language === 'zh-CN' ? '至少需要一个字段' : 'At least one field is required');
          setLoading(false);
          return;
        }
        for (const { field, value } of validFields) {
          const result = await onExecute(`HSET "${key}" "${field}" "${value.replace(/"/g, '\\"')}"`);
          if (!result?.success) throw new Error(result?.error);
        }
      } else if (keyType === 'list') {
        const validItems = listItems.filter(item => item.trim());
        if (validItems.length === 0) {
          setError(settings.language === 'zh-CN' ? '至少需要一个元素' : 'At least one item is required');
          setLoading(false);
          return;
        }
        for (const item of validItems) {
          const result = await onExecute(`RPUSH "${key}" "${item.replace(/"/g, '\\"')}"`);
          if (!result?.success) throw new Error(result?.error);
        }
      } else if (keyType === 'set') {
        const validItems = listItems.filter(item => item.trim());
        if (validItems.length === 0) {
          setError(settings.language === 'zh-CN' ? '至少需要一个成员' : 'At least one member is required');
          setLoading(false);
          return;
        }
        for (const item of validItems) {
          const result = await onExecute(`SADD "${key}" "${item.replace(/"/g, '\\"')}"`);
          if (!result?.success) throw new Error(result?.error);
        }
      } else if (keyType === 'zset') {
        const validMembers = zsetMembers.filter(m => m.member.trim());
        if (validMembers.length === 0) {
          setError(settings.language === 'zh-CN' ? '至少需要一个成员' : 'At least one member is required');
          setLoading(false);
          return;
        }
        for (const { member, score } of validMembers) {
          const scoreNum = parseFloat(score) || 0;
          const result = await onExecute(`ZADD "${key}" ${scoreNum} "${member.replace(/"/g, '\\"')}"`);
          if (!result?.success) throw new Error(result?.error);
        }
      }

      // 设置 TTL
      if (ttl.trim() && parseInt(ttl) > 0) {
        await onExecute(`EXPIRE "${key}" ${parseInt(ttl)}`);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Hash 字段操作
  const addHashField = () => setHashFields([...hashFields, { field: '', value: '' }]);
  const removeHashField = (index: number) => {
    if (hashFields.length > 1) {
      setHashFields(hashFields.filter((_, i) => i !== index));
    }
  };
  const updateHashField = (index: number, key: 'field' | 'value', value: string) => {
    const newFields = [...hashFields];
    newFields[index][key] = value;
    setHashFields(newFields);
  };

  // List/Set 元素操作
  const addListItem = () => setListItems([...listItems, '']);
  const removeListItem = (index: number) => {
    if (listItems.length > 1) {
      setListItems(listItems.filter((_, i) => i !== index));
    }
  };
  const updateListItem = (index: number, value: string) => {
    const newItems = [...listItems];
    newItems[index] = value;
    setListItems(newItems);
  };

  // ZSet 成员操作
  const addZsetMember = () => setZsetMembers([...zsetMembers, { member: '', score: '0' }]);
  const removeZsetMember = (index: number) => {
    if (zsetMembers.length > 1) {
      setZsetMembers(zsetMembers.filter((_, i) => i !== index));
    }
  };
  const updateZsetMember = (index: number, key: 'member' | 'score', value: string) => {
    const newMembers = [...zsetMembers];
    newMembers[index][key] = value;
    setZsetMembers(newMembers);
  };

  const typeOptions: { value: KeyType; label: string }[] = [
    { value: 'string', label: 'String' },
    { value: 'hash', label: 'Hash' },
    { value: 'list', label: 'List' },
    { value: 'set', label: 'Set' },
    { value: 'zset', label: 'ZSet' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={settings.language === 'zh-CN' ? '新建 Key' : 'New Key'}
      width={500}
      height={500}
      minWidth={400}
      minHeight={350}
      className="new-key-modal"
      storageKey="new-key"
    >
      <form onSubmit={handleSubmit} className="modal-form">
        {error && <div className="form-error">{error}</div>}

        {/* Key 名称 */}
        <div className="form-group">
          <label>{settings.language === 'zh-CN' ? 'Key 名称' : 'Key Name'} *</label>
          <input
            type="text"
            value={keyName}
            onChange={e => setKeyName(e.target.value)}
            placeholder={settings.language === 'zh-CN' ? '输入 Key 名称' : 'Enter key name'}
            autoFocus
          />
        </div>

        {/* 类型选择 */}
        <div className="form-group">
          <label>{settings.language === 'zh-CN' ? '类型' : 'Type'}</label>
          <div className="type-options">
            {typeOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                className={`type-option ${keyType === opt.value ? 'active' : ''}`}
                onClick={() => setKeyType(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* TTL */}
        <div className="form-group">
          <label>TTL ({settings.language === 'zh-CN' ? '秒，留空永不过期' : 'seconds, empty for no expiry'})</label>
          <input
            type="number"
            value={ttl}
            onChange={e => setTtl(e.target.value)}
            placeholder={settings.language === 'zh-CN' ? '过期时间' : 'Expiry time'}
            min="0"
          />
        </div>

        {/* String 值 */}
        {keyType === 'string' && (
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '值' : 'Value'} *</label>
            <textarea
              value={stringValue}
              onChange={e => setStringValue(e.target.value)}
              placeholder={settings.language === 'zh-CN' ? '输入字符串值' : 'Enter string value'}
              rows={4}
            />
          </div>
        )}

        {/* Hash 字段 */}
        {keyType === 'hash' && (
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '字段' : 'Fields'} *</label>
            <div className="dynamic-fields">
              {hashFields.map((item, index) => (
                <div key={index} className="field-row">
                  <input
                    type="text"
                    value={item.field}
                    onChange={e => updateHashField(index, 'field', e.target.value)}
                    placeholder="Field"
                  />
                  <input
                    type="text"
                    value={item.value}
                    onChange={e => updateHashField(index, 'value', e.target.value)}
                    placeholder="Value"
                  />
                  <button
                    type="button"
                    className="remove-btn"
                    onClick={() => removeHashField(index)}
                    disabled={hashFields.length === 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="add-field-btn" onClick={addHashField}>
                <Plus size={14} /> {settings.language === 'zh-CN' ? '添加字段' : 'Add Field'}
              </button>
            </div>
          </div>
        )}

        {/* List/Set 元素 */}
        {(keyType === 'list' || keyType === 'set') && (
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '元素' : 'Items'} *</label>
            <div className="dynamic-fields">
              {listItems.map((item, index) => (
                <div key={index} className="field-row single">
                  <input
                    type="text"
                    value={item}
                    onChange={e => updateListItem(index, e.target.value)}
                    placeholder={`${settings.language === 'zh-CN' ? '元素' : 'Item'} ${index + 1}`}
                  />
                  <button
                    type="button"
                    className="remove-btn"
                    onClick={() => removeListItem(index)}
                    disabled={listItems.length === 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="add-field-btn" onClick={addListItem}>
                <Plus size={14} /> {settings.language === 'zh-CN' ? '添加元素' : 'Add Item'}
              </button>
            </div>
          </div>
        )}

        {/* ZSet 成员 */}
        {keyType === 'zset' && (
          <div className="form-group">
            <label>{settings.language === 'zh-CN' ? '成员' : 'Members'} *</label>
            <div className="dynamic-fields">
              {zsetMembers.map((item, index) => (
                <div key={index} className="field-row">
                  <input
                    type="text"
                    value={item.member}
                    onChange={e => updateZsetMember(index, 'member', e.target.value)}
                    placeholder="Member"
                    className="flex-2"
                  />
                  <input
                    type="number"
                    value={item.score}
                    onChange={e => updateZsetMember(index, 'score', e.target.value)}
                    placeholder="Score"
                    className="flex-1"
                    step="any"
                  />
                  <button
                    type="button"
                    className="remove-btn"
                    onClick={() => removeZsetMember(index)}
                    disabled={zsetMembers.length === 1}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className="add-field-btn" onClick={addZsetMember}>
                <Plus size={14} /> {settings.language === 'zh-CN' ? '添加成员' : 'Add Member'}
              </button>
            </div>
          </div>
        )}

        <div className="modal-footer">
          <button type="button" className="cancel-btn" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="submit-btn" disabled={loading}>
            {loading
              ? (settings.language === 'zh-CN' ? '创建中...' : 'Creating...')
              : (settings.language === 'zh-CN' ? '创建' : 'Create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default NewKeyModal;
