const DEFAULT_PIPELINES = [
  {
    id: 'default',
    name: 'Default Pipeline',
    stages: [
      { id: 'new', name: 'New Lead', color: '#2563eb', formFields: ['requirement','budget','location'] },
      { id: 'contacted', name: 'Contacted', color: '#7c3aed', formFields: ['contactResult','nextAction'] },
      { id: 'qualified', name: 'Qualified', color: '#d97706', formFields: ['budget','location','propertyType'] },
      { id: 'viewing', name: 'Viewing', color: '#0891b2', formFields: ['viewingDate','propertyShown'] },
      { id: 'negotiation', name: 'Negotiation', color: '#dc2626', formFields: ['offerPrice','sellerResponse'] },
      { id: 'closed', name: 'Closed', color: '#16a34a', formFields: ['dealValue','closingNote'] },
      { id: 'dead', name: 'Dead', color: '#6b7280', formFields: ['lostReason'] }
    ]
  }
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['pipelines', 'leads'], (res) => {
    const patch = {};
    if (!res.pipelines) patch.pipelines = DEFAULT_PIPELINES;
    if (!res.leads) patch.leads = {};
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'OPEN_DASHBOARD') {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  }
  if (msg?.type === 'OPEN_WA') {
    chrome.tabs.create({ url: msg.url || 'https://web.whatsapp.com/' });
  }
});
