(function () {
  const { useEffect, useState } = React;
  const API_BASE_URL =
    (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) || window.location.origin;
  const ACCOUNT_EMAIL_DOMAIN =
    (window.APP_CONFIG && window.APP_CONFIG.accountEmailDomain) || 'rikkeisoft.com';

  function stripDiacritics(value) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  function normalizeName(value) {
    if (!value) return '';
    return stripDiacritics(value).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function toAccountKey(value) {
    const raw = normalizeName(value || '').replace(/\s+/g, '');
    if (!raw) return '';
    if (!raw.includes('@')) return raw;

    const parts = raw.split('@');
    if (parts.length < 2 || !parts[0]) return '';
    return parts[1] === ACCOUNT_EMAIL_DOMAIN ? parts[0] : `${parts[0]}@${parts[1]}`;
  }

  function toAccountEmail(accountKey) {
    const key = toAccountKey(accountKey);
    if (!key) return '';
    if (key.includes('@')) return key;
    return `${key}@${ACCOUNT_EMAIL_DOMAIN}`;
  }

  function parseParticipantNamesFromText(raw) {
    if (!raw || typeof raw !== 'string') return [];

    const map = new Map();
    const items = raw.split(/[\n,;]+/);
    for (const item of items) {
      const name = item.trim();
      const key = toAccountKey(name);
      if (!key) continue;
      if (!map.has(key)) {
        map.set(key, key);
      }
    }

    return Array.from(map.values());
  }

  function parseParticipantAmountsFromText(raw) {
    if (!raw || typeof raw !== 'string') return { names: [], amounts: {} };

    const names = [];
    const amounts = {};
    const seen = new Set();
    const lines = raw.split(/[\n]+/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const spaceIdx = trimmed.search(/\s/);
      if (spaceIdx < 0) continue;
      const namePart = trimmed.slice(0, spaceIdx).trim();
      const amountStr = trimmed.slice(spaceIdx).replace(/\s/g, '').replace(/k$/i, '000');
      const key = toAccountKey(namePart);
      if (!key) continue;
      const amount = parseInt(amountStr.replace(/\D/g, ''), 10);
      if (!amount || amount <= 0) continue;
      if (!seen.has(key)) {
        seen.add(key);
        names.push(key);
      }
      amounts[key] = amount;
    }

    return { names, amounts };
  }

  function getPaidParticipantKeys(campaign) {
    const paidKeys = new Set();
    const entries = Object.values(campaign.paidUsers || {});
    for (const entry of entries) {
      const key = toAccountKey(
        (entry && (entry.participantName || entry.displayName || entry.email || entry.userPrincipalName)) || ''
      );
      if (key) paidKeys.add(key);
    }
    return paidKeys;
  }

  function getPayerKey(campaign) {
    return toAccountKey(campaign.payerCode || '');
  }

  function getExpectedRepayers(campaign) {
    const participants = Array.isArray(campaign.participants) ? campaign.participants : [];
    if (participants.length === 0) {
      return Number(campaign.expectedPeople || 0);
    }

    const payerKey = getPayerKey(campaign);
    if (!payerKey) return participants.length;

    let count = 0;
    for (const name of participants) {
      if (toAccountKey(name) === payerKey) continue;
      count += 1;
    }
    return count;
  }

  function getPaidCount(campaign) {
    const participants = Array.isArray(campaign.participants) ? campaign.participants : [];
    if (participants.length === 0) {
      return Object.keys(campaign.paidUsers || {}).length;
    }

    const paidKeys = getPaidParticipantKeys(campaign);
    const payerKey = getPayerKey(campaign);
    let count = 0;

    for (const name of participants) {
      const key = toAccountKey(name);
      if (payerKey && key === payerKey) continue;
      if (paidKeys.has(key)) count += 1;
    }

    return count;
  }

  function getUnpaidNames(campaign) {
    const participants = Array.isArray(campaign.participants) ? campaign.participants : [];
    if (participants.length === 0) return [];

    const paidKeys = getPaidParticipantKeys(campaign);
    const payerKey = getPayerKey(campaign);

    return participants.filter((name) => {
      const key = toAccountKey(name);
      if (payerKey && key === payerKey) return false;
      return !paidKeys.has(key);
    });
  }

  function getTodayDateInputValue() {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return localNow.toISOString().slice(0, 10);
  }

  function App() {
    const [openCampaigns, setOpenCampaigns] = useState([]);
    const [nameDebts, setNameDebts] = useState([]);
    const [settlements, setSettlements] = useState([]);
    const [status, setStatus] = useState('');
    const [error, setError] = useState('');
    const [commandHelp, setCommandHelp] = useState('');

    const SPLIT_MODE_AUTO = 'auto';
    const SPLIT_MODE_MANUAL = 'manual';
    const SPLIT_MODE_CUSTOM = 'custom';

    const [manualForm, setManualForm] = useState({
      splitMode: SPLIT_MODE_AUTO,
      title: 'Cơm trưa hôm nay',
      mealDate: getTodayDateInputValue(),
      totalAmount: 300000,
      perPersonAmount: 100000,
      expectedPeople: 10,
      payerCode: 'anv1',
      participantNamesText: 'anv1\nbnv1\ncnv1',
      customAmountsText: 'anv1 100000\nbnv1 80000\ncnv1 100000',
      sourceText: 'Trưa nay mỗi người 100k, tổng 3 người',
      reminderImageUrl: ''
    });

    async function callApi(path, options) {
      const response = await fetch(`${API_BASE_URL}${path}`, options);
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        const hint = text.startsWith('<') ? ' (phản hồi HTML - kiểm tra URL API)' : '';
        throw new Error(`Phản hồi không hợp lệ${hint}: ${response.status} ${response.statusText}`);
      }
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Yêu cầu thất bại');
      }
      return data;
    }

    async function refresh() {
      try {
        setError('');
        const [campaignsRes, debtsRes, settlementsRes, helpRes] = await Promise.all([
          callApi('/campaigns/open'),
          callApi('/debts/by-name'),
          callApi('/debts/settlements'),
          callApi('/help/command').catch(() => ({ ok: true, data: { help: '' } }))
        ]);
        setOpenCampaigns(campaignsRes.data);
        setNameDebts(debtsRes.data);
        setSettlements(settlementsRes.data);
        setCommandHelp(helpRes.data?.help || '');
      } catch (e) {
        setError(e.message);
      }
    }

    useEffect(() => {
      refresh();
    }, []);

    async function createCampaign(e) {
      e.preventDefault();
      try {
        setError('');
        setStatus('Đang tạo khoản thu...');

        const participantNames = parseParticipantNamesFromText(manualForm.participantNamesText);
        if (participantNames.length > 0 && !manualForm.payerCode.trim()) {
          throw new Error('Cần nhập mã account người ứng tiền (payerCode)');
        }

        let perPersonAmount;
        let expectedPeople;
        let perPersonAmounts;

        if (manualForm.splitMode === SPLIT_MODE_AUTO) {
          if (participantNames.length === 0) {
            throw new Error('Chế độ Auto cần danh sách người để chia đều tiền');
          }
          const totalAmount = Number(manualForm.totalAmount);
          if (!totalAmount || totalAmount <= 0) {
            throw new Error('Tổng số tiền phải > 0');
          }
          perPersonAmount = Math.round(totalAmount / participantNames.length);
          if (perPersonAmount <= 0) {
            throw new Error('Tổng số tiền chia cho số người phải > 0');
          }
          expectedPeople = participantNames.length;
        } else if (manualForm.splitMode === SPLIT_MODE_CUSTOM) {
          const { names: customNames, amounts: customAmounts } = parseParticipantAmountsFromText(manualForm.customAmountsText);
          if (customNames.length === 0) {
            throw new Error('Chế độ Custom cần danh sách "tên số_tiền" (mỗi dòng 1 người, VD: anv1 100000)');
          }
          const payerKey = toAccountKey(manualForm.payerCode.trim());
          for (const key of customNames) {
            if (key === payerKey) continue;
            if (!customAmounts[key] || customAmounts[key] <= 0) {
              throw new Error(`Số tiền cho ${key} phải > 0`);
            }
          }
          perPersonAmounts = customAmounts;
          participantNames.length = 0;
          participantNames.push(...customNames);
          expectedPeople = customNames.length;
        } else {
          perPersonAmount = Number(manualForm.perPersonAmount);
          expectedPeople = Number(manualForm.expectedPeople);
          if (!perPersonAmount || perPersonAmount <= 0) {
            throw new Error('Số tiền mỗi người phải > 0');
          }
          if (!expectedPeople || expectedPeople <= 0) {
            throw new Error('Tổng số người phải > 0');
          }
        }

        const body = {
          title: manualForm.title,
          dateKey: manualForm.mealDate,
          expectedPeople,
          payerCode: manualForm.payerCode.trim(),
          participantNames,
          sourceText: manualForm.sourceText
        };
        if (manualForm.reminderImageUrl && manualForm.reminderImageUrl.trim()) {
          body.reminderImageUrl = manualForm.reminderImageUrl.trim();
        }
        if (perPersonAmounts) {
          body.perPersonAmounts = perPersonAmounts;
        } else {
          body.perPersonAmount = perPersonAmount;
        }

        await callApi('/campaigns/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        setStatus('Đã tạo khoản thu và gửi thông báo ai nợ ai.');
        await refresh();
      } catch (e) {
        setError(e.message);
      }
    }

    async function markPaid(rootMessageId, payload) {
      if (!payload) return;
      try {
        setError('');
        await callApi(`/campaigns/${encodeURIComponent(rootMessageId)}/paid`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const label = payload.participantName || payload.displayName || payload.userId;
        setStatus(`Đã đánh dấu ${label} đã trả.`);
        await refresh();
      } catch (e) {
        setError(e.message);
      }
    }

    async function remindCampaign(rootMessageId) {
      try {
        setError('');
        setStatus('Đang gửi nhắc nợ...');
        await callApi(`/campaigns/${encodeURIComponent(rootMessageId)}/remind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        setStatus('Đã gửi nhắc nợ vào Teams.');
        await refresh();
      } catch (e) {
        setError(e.message);
      }
    }

    const participantPreview = parseParticipantNamesFromText(manualForm.participantNamesText);

    return React.createElement(
      'div',
      { className: 'wrap' },
      React.createElement('div', { className: 'panel' },
        React.createElement('h1', null, 'Quản lý nợ tiền cơm trưa (Teams webhook)'),
        React.createElement('p', { className: 'small' }, `Nhập account như anv1, hệ thống tự hiểu mail là ${toAccountEmail('anv1')}.`)
      ),

      commandHelp
        ? React.createElement('div', { className: 'panel' },
            React.createElement('h2', null, 'Lệnh tạo nợ trong Teams chat'),
            React.createElement('pre', { className: 'small help-pre' }, commandHelp)
          )
        : null,

      React.createElement('form', { className: 'panel', onSubmit: createCampaign },
        React.createElement('h2', null, '1) Tạo bữa trưa cần thu tiền'),
        React.createElement('div', { className: 'split-mode-row' },
          React.createElement('label', null,
            React.createElement('input', {
              type: 'radio',
              name: 'splitMode',
              checked: manualForm.splitMode === SPLIT_MODE_AUTO,
              onChange: () => setManualForm({ ...manualForm, splitMode: SPLIT_MODE_AUTO })
            }),
            'Auto: nhập tổng tiền + tên, chia đều'
          ),
          React.createElement('label', null,
            React.createElement('input', {
              type: 'radio',
              name: 'splitMode',
              checked: manualForm.splitMode === SPLIT_MODE_MANUAL,
              onChange: () => setManualForm({ ...manualForm, splitMode: SPLIT_MODE_MANUAL })
            }),
            'Manual: mỗi người cùng số tiền'
          ),
          React.createElement('label', null,
            React.createElement('input', {
              type: 'radio',
              name: 'splitMode',
              checked: manualForm.splitMode === SPLIT_MODE_CUSTOM,
              onChange: () => setManualForm({ ...manualForm, splitMode: SPLIT_MODE_CUSTOM })
            }),
            'Custom: mỗi người số tiền khác nhau (VD: người già ít hơn)'
          )
        ),
        React.createElement('div', { className: 'grid' },
          React.createElement('label', null, 'Tiêu đề',
            React.createElement('input', {
              value: manualForm.title,
              onChange: (e) => setManualForm({ ...manualForm, title: e.target.value })
            })
          ),
          React.createElement('label', null, 'Ngày bữa trưa',
            React.createElement('input', {
              type: 'date',
              value: manualForm.mealDate,
              onChange: (e) => setManualForm({ ...manualForm, mealDate: e.target.value })
            })
          ),
          manualForm.splitMode === SPLIT_MODE_AUTO
            ? React.createElement('label', null, 'Tổng số tiền (VND)',
                React.createElement('input', {
                  type: 'number',
                  min: 1,
                  value: manualForm.totalAmount,
                  onChange: (e) => setManualForm({ ...manualForm, totalAmount: Number(e.target.value) })
                })
              )
            : manualForm.splitMode === SPLIT_MODE_CUSTOM
              ? null
              : React.createElement('label', null, 'Số tiền mỗi người (VND)',
                  React.createElement('input', {
                    type: 'number',
                    min: 1,
                    value: manualForm.perPersonAmount,
                    onChange: (e) => setManualForm({ ...manualForm, perPersonAmount: Number(e.target.value) })
                  })
                ),
          React.createElement('label', null, 'Mã account người ứng tiền (payerCode)',
            React.createElement('input', {
              value: manualForm.payerCode,
              onChange: (e) => setManualForm({ ...manualForm, payerCode: e.target.value }),
              placeholder: 'vd: anv1'
            })
          ),
          manualForm.splitMode === SPLIT_MODE_MANUAL
            ? React.createElement('label', null, 'Tổng số người (fallback nếu không nhập danh sách)',
                React.createElement('input', {
                  type: 'number',
                  min: 1,
                  value: manualForm.expectedPeople,
                  onChange: (e) => setManualForm({ ...manualForm, expectedPeople: Number(e.target.value) })
                })
              )
            : manualForm.splitMode === SPLIT_MODE_CUSTOM
              ? null
              : null
        ),
        manualForm.splitMode === SPLIT_MODE_CUSTOM
          ? React.createElement('label', null,
              'Danh sách "tên số_tiền" (mỗi dòng 1 người, VD: người già ít hơn)',
              React.createElement('textarea', {
                value: manualForm.customAmountsText,
                onChange: (e) => setManualForm({ ...manualForm, customAmountsText: e.target.value }),
                placeholder: 'anv1 100000\nbnv1 80000\ncnv1 100000'
              })
            )
          : React.createElement('label', null,
              manualForm.splitMode === SPLIT_MODE_AUTO ? 'Danh sách mã account (bắt buộc, mỗi dòng 1 người)' : 'Danh sách mã account (mỗi dòng 1 người)',
              React.createElement('textarea', {
                value: manualForm.participantNamesText,
                onChange: (e) => setManualForm({ ...manualForm, participantNamesText: e.target.value }),
                placeholder: 'anv1\nbnv1\ncnv1'
              })
            ),
        manualForm.splitMode === SPLIT_MODE_AUTO && participantPreview.length > 0
          ? React.createElement('p', { className: 'small' }, `Số account: ${participantPreview.length} → ${Math.round(manualForm.totalAmount / participantPreview.length).toLocaleString('vi-VN')} VND/người`)
          : manualForm.splitMode === SPLIT_MODE_CUSTOM
            ? (() => {
                const { names: customNames, amounts: customAmounts } = parseParticipantAmountsFromText(manualForm.customAmountsText);
                const total = customNames.reduce((s, k) => s + (customAmounts[k] || 0), 0);
                return customNames.length > 0
                  ? React.createElement('p', { className: 'small' }, `${customNames.length} người, tổng ${total.toLocaleString('vi-VN')} VND`)
                  : React.createElement('p', { className: 'small' }, 'Định dạng: tên khoảng_trắng số_tiền (VD: anv1 100000)');
              })()
            : React.createElement('p', { className: 'small' }, `Số account hợp lệ: ${participantPreview.length}`),
        React.createElement('label', null, 'Nội dung gốc (để hiển thị trong tin nhắc nợ)',
          React.createElement('textarea', {
            value: manualForm.sourceText,
            onChange: (e) => setManualForm({ ...manualForm, sourceText: e.target.value })
          })
        ),
        React.createElement('label', null, 'URL ảnh nhúng vào tin nhắc nợ (tùy chọn)',
          React.createElement('input', {
            type: 'url',
            value: manualForm.reminderImageUrl,
            onChange: (e) => setManualForm({ ...manualForm, reminderImageUrl: e.target.value }),
            placeholder: 'https://example.com/image.png'
          })
        ),
        React.createElement('div', { className: 'row' },
          React.createElement('button', { type: 'submit' }, 'Tạo khoản thu')
        )
      ),

      React.createElement('div', { className: 'panel' },
        React.createElement('h2', null, '2) Tổng nợ theo account'),
        nameDebts.length === 0
          ? React.createElement('p', { className: 'small' }, 'Chưa có dữ liệu tổng nợ theo account.')
          : nameDebts.map((item) => React.createElement('p', { className: 'small', key: item.name },
              `${item.name} (${item.email || toAccountEmail(item.name)}): ${item.totalDebt.toLocaleString('vi-VN')} VND | Nợ ai: ${item.owedTo.join(', ')} | Ngày nợ: ${item.pendingDates.join(', ')}`
            ))
      ),

      React.createElement('div', { className: 'panel' },
        React.createElement('h2', null, '3) Cân đối ai nợ ai (đã bù trừ qua nhiều ngày)'),
        settlements.length === 0
          ? React.createElement('p', { className: 'small' }, 'Chưa có cặp công nợ cần đối.')
          : settlements.map((item) => React.createElement('p', {
              className: 'small',
              key: `${item.debtorName}-${item.creditorName}`
            }, `${item.debtorName} (${item.debtorEmail || toAccountEmail(item.debtorName)}) nợ ${item.creditorName} (${item.creditorEmail || toAccountEmail(item.creditorName)}): ${item.amount.toLocaleString('vi-VN')} VND (ngày: ${item.pendingDates.join(', ')})`))
      ),

      React.createElement('div', { className: 'panel' },
        React.createElement('h2', null, '4) Danh sách khoản thu đang nợ'),
        React.createElement('div', { className: 'row' },
          React.createElement('button', { type: 'button', className: 'secondary', onClick: refresh }, 'Tải lại')
        ),
        openCampaigns.length === 0
          ? React.createElement('p', { className: 'small' }, 'Không có khoản thu nào đang mở.')
          : openCampaigns.map((campaign) => React.createElement(CampaignCard, {
              key: campaign.rootMessageId,
              campaign,
              onMarkPaid: markPaid,
              onRemind: remindCampaign,
              getPaidCount,
              getExpectedRepayers,
              getUnpaidNames
            }))
      ),

      React.createElement('div', { className: 'status' + (error ? ' error' : '') }, error || status)
    );
  }

  function CampaignCard({ campaign, onMarkPaid, onRemind, getPaidCount, getExpectedRepayers, getUnpaidNames }) {
    const paidCount = getPaidCount(campaign);
    const expected = getExpectedRepayers(campaign);
    const outstanding = Math.max(expected - paidCount, 0);
    const participants = Array.isArray(campaign.participants) ? campaign.participants : [];
    const hasParticipants = participants.length > 0;
    const unpaidNames = getUnpaidNames(campaign);

    const [participantName, setParticipantName] = useState('');
    const [userId, setUserId] = useState('');
    const [displayName, setDisplayName] = useState('');

    return React.createElement('div', { className: 'campaign' },
      React.createElement('p', { className: 'campaign-title' }, campaign.title),
      React.createElement('p', { className: 'small' }, `ID: ${campaign.rootMessageId}`),
      React.createElement('p', { className: 'small' }, `Ngày bữa: ${campaign.dateKey || 'Không rõ'}`),
      React.createElement('p', { className: 'small' }, `Người ứng tiền: ${campaign.payerCode || 'Không rõ'} (${campaign.payerCode ? toAccountEmail(campaign.payerCode) : 'Không rõ'})`),
      React.createElement('p', { className: 'small' }, `Đã trả: ${paidCount}/${expected} | Còn thiếu: ${outstanding}`),
      campaign.perPersonAmounts && typeof campaign.perPersonAmounts === 'object'
        ? React.createElement('p', { className: 'small' },
            'Tiền mỗi người: ',
            Object.entries(campaign.perPersonAmounts)
              .filter(([, amt]) => amt > 0)
              .map(([name, amt]) => `${name}: ${Number(amt).toLocaleString('vi-VN')} VND`)
              .join(' | ')
          )
        : React.createElement('p', { className: 'small' }, `Tiền mỗi người: ${(campaign.perPersonAmount || 0).toLocaleString('vi-VN')} VND`),
      hasParticipants
        ? React.createElement('p', { className: 'small' }, `Còn nợ: ${unpaidNames.length > 0 ? unpaidNames.join(', ') : 'Không ai'}`)
        : null,
      React.createElement('div', { className: 'row' },
        React.createElement('button', {
          type: 'button',
          className: 'secondary',
          onClick: function () {
            if (onRemind) onRemind(campaign.rootMessageId);
          }
        }, 'Nhắc nợ vào Teams'),
        hasParticipants
          ? React.createElement(React.Fragment, null,
              React.createElement('input', {
                value: participantName,
                onChange: (e) => setParticipantName(e.target.value),
                placeholder: 'Mã account đã trả (vd anv1)'
              }),
              React.createElement('input', {
                value: userId,
                onChange: (e) => setUserId(e.target.value),
                placeholder: 'userId Teams (không bắt buộc)'
              }),
              React.createElement('button', {
                type: 'button',
                onClick: function () {
                  if (!participantName.trim()) return;
                  onMarkPaid(campaign.rootMessageId, {
                    participantName: toAccountKey(participantName.trim()),
                    displayName: toAccountKey(participantName.trim()),
                    userId: userId.trim() || undefined
                  });
                  setParticipantName('');
                  setUserId('');
                }
              }, 'Đánh dấu đã trả')
            )
          : null
      ),
      !hasParticipants
        ? React.createElement('div', { className: 'row' },
            React.createElement('input', {
              value: userId,
              onChange: (e) => setUserId(e.target.value),
              placeholder: 'userId (AAD id)'
            }),
            React.createElement('input', {
              value: displayName,
              onChange: (e) => setDisplayName(e.target.value),
              placeholder: 'displayName'
            }),
            React.createElement('button', {
              type: 'button',
              onClick: function () {
                if (!userId.trim() && !displayName.trim()) return;
                onMarkPaid(campaign.rootMessageId, {
                  userId: userId.trim() || undefined,
                  displayName: displayName.trim() || undefined
                });
                setUserId('');
                setDisplayName('');
              }
            }, 'Đánh dấu đã trả')
          )
        : null
    );
  }

  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(App));
})();
