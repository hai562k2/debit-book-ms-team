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

    const [manualForm, setManualForm] = useState({
      title: 'Cơm trưa hôm nay',
      mealDate: getTodayDateInputValue(),
      perPersonAmount: 100000,
      expectedPeople: 10,
      payerCode: 'anv1',
      participantNamesText: 'anv1\nbnv1\ncnv1',
      sourceText: 'Trưa nay mỗi người 100k, tổng 3 người'
    });

    async function callApi(path, options) {
      const response = await fetch(`${API_BASE_URL}${path}`, options);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Yêu cầu thất bại');
      }
      return data;
    }

    async function refresh() {
      try {
        setError('');
        const [campaignsRes, debtsRes, settlementsRes] = await Promise.all([
          callApi('/campaigns/open'),
          callApi('/debts/by-name'),
          callApi('/debts/settlements')
        ]);
        setOpenCampaigns(campaignsRes.data);
        setNameDebts(debtsRes.data);
        setSettlements(settlementsRes.data);
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

        await callApi('/campaigns/manual', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: manualForm.title,
            dateKey: manualForm.mealDate,
            perPersonAmount: Number(manualForm.perPersonAmount),
            expectedPeople: Number(manualForm.expectedPeople),
            payerCode: manualForm.payerCode.trim(),
            participantNames,
            sourceText: manualForm.sourceText
          })
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

    const participantPreview = parseParticipantNamesFromText(manualForm.participantNamesText);

    return React.createElement(
      'div',
      { className: 'wrap' },
      React.createElement('div', { className: 'panel' },
        React.createElement('h1', null, 'Quản lý nợ tiền cơm trưa (Teams webhook)'),
        React.createElement('p', { className: 'small' }, `Nhập account như anv1, hệ thống tự hiểu mail là ${toAccountEmail('anv1')}.`)
      ),

      React.createElement('form', { className: 'panel', onSubmit: createCampaign },
        React.createElement('h2', null, '1) Tạo bữa trưa cần thu tiền'),
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
          React.createElement('label', null, 'Số tiền mỗi người (VND)',
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
          React.createElement('label', null, 'Tổng số người (fallback nếu không nhập danh sách)',
            React.createElement('input', {
              type: 'number',
              min: 1,
              value: manualForm.expectedPeople,
              onChange: (e) => setManualForm({ ...manualForm, expectedPeople: Number(e.target.value) })
            })
          )
        ),
        React.createElement('label', null, 'Danh sách mã account (mỗi dòng 1 người)',
          React.createElement('textarea', {
            value: manualForm.participantNamesText,
            onChange: (e) => setManualForm({ ...manualForm, participantNamesText: e.target.value }),
            placeholder: 'anv1\nbnv1\ncnv1'
          })
        ),
        React.createElement('p', { className: 'small' }, `Số account hợp lệ: ${participantPreview.length}`),
        React.createElement('label', null, 'Nội dung gốc (để hiển thị trong tin nhắc nợ)',
          React.createElement('textarea', {
            value: manualForm.sourceText,
            onChange: (e) => setManualForm({ ...manualForm, sourceText: e.target.value })
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
              getPaidCount,
              getExpectedRepayers,
              getUnpaidNames
            }))
      ),

      React.createElement('div', { className: 'status' + (error ? ' error' : '') }, error || status)
    );
  }

  function CampaignCard({ campaign, onMarkPaid, getPaidCount, getExpectedRepayers, getUnpaidNames }) {
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
      React.createElement('p', { className: 'small' }, `Tiền mỗi người: ${(campaign.perPersonAmount || 0).toLocaleString('vi-VN')} VND`),
      hasParticipants
        ? React.createElement('p', { className: 'small' }, `Còn nợ: ${unpaidNames.length > 0 ? unpaidNames.join(', ') : 'Không ai'}`)
        : null,
      hasParticipants
        ? React.createElement('div', { className: 'row' },
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
        : React.createElement('div', { className: 'row' },
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
    );
  }

  ReactDOM.createRoot(document.getElementById('app')).render(React.createElement(App));
})();
