const state = {
  activeTab: 'Health',
  historyOffset: 0,
  historyLimit: 10,
  policyOffset: 0,
  policyLimit: 10,
  tools: [],
  data: null,
  tryResult: null,
};

const tabs = ['Health', 'Tools', 'Processes', 'Logs', 'Policy'];

const panel = document.getElementById('panel');
const tabsEl = document.getElementById('tabs');

function setActiveTab(tab) {
  state.activeTab = tab;
  renderTabs();
  renderPanel();
}

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const tab of tabs) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tab ${tab === state.activeTab ? 'active' : ''}`;
    b.textContent = tab;
    b.onclick = () => setActiveTab(tab);
    tabsEl.appendChild(b);
  }
}

async function loadData() {
  const params = new URLSearchParams({
    history_offset: String(state.historyOffset),
    history_limit: String(state.historyLimit),
    policy_offset: String(state.policyOffset),
    policy_limit: String(state.policyLimit),
  });
  const [dataRes, toolsRes] = await Promise.all([
    fetch(`/gui/data?${params.toString()}`),
    fetch('/tools/list'),
  ]);
  state.data = await dataRes.json();
  state.tools = (await toolsRes.json()).tools || [];
  renderPanel();
}

function card(title, content) {
  return `<div class="card"><h3>${title}</h3>${content}</div>`;
}

function renderHistoryPager(offset, limit, total, onPrev, onNext) {
  const div = document.createElement('div');
  div.className = 'pager';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = 'Previous';
  prev.disabled = offset === 0;
  prev.onclick = onPrev;
  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next';
  next.disabled = offset + limit >= total;
  next.onclick = onNext;
  div.append(prev, next);
  return div;
}

function renderPanel() {
  if (!state.data) {
    panel.innerHTML = '<p>Loading...</p>';
    return;
  }

  const data = state.data;

  if (state.activeTab === 'Health') {
    panel.innerHTML = card('Server', `<p>Healthy: <b>${data.health?.ok ? 'yes' : 'no'}</b></p>`)
      + card('Counters', `<pre>${JSON.stringify(data.error_counters || {}, null, 2)}</pre>`);
    return;
  }

  if (state.activeTab === 'Tools') {
    const select = document.createElement('select');
    const toolOptions = state.tools.filter(t => t.method !== 'GET');
    for (const tool of toolOptions) {
      const op = document.createElement('option');
      op.value = tool.name;
      op.textContent = `${tool.name} (${tool.path})`;
      select.appendChild(op);
    }

    const formContainer = document.createElement('div');
    const result = document.createElement('pre');
    if (state.tryResult) result.textContent = JSON.stringify(state.tryResult, null, 2);

    const renderToolForm = () => {
      formContainer.innerHTML = '';
      const tool = toolOptions.find(t => t.name === select.value) || toolOptions[0];
      if (!tool) return;
      const schema = tool.request_schema || { properties: {} };
      const properties = schema.properties || {};
      const required = new Set(schema.required || []);
      const fields = {};

      for (const [name, fieldSchema] of Object.entries(properties)) {
        const row = document.createElement('div');
        row.className = 'form-row';
        const label = document.createElement('label');
        label.textContent = `${name}${required.has(name) ? ' *' : ''}`;
        const isObject = ['object', 'array'].includes(fieldSchema.type);
        const input = document.createElement(isObject ? 'textarea' : 'input');
        input.placeholder = fieldSchema.type || 'string';
        if (fieldSchema.default !== undefined) {
          input.value = isObject ? JSON.stringify(fieldSchema.default) : String(fieldSchema.default);
        }
        row.append(label, input);
        formContainer.appendChild(row);
        fields[name] = { input, schema: fieldSchema, required: required.has(name) };
      }

      const submit = document.createElement('button');
      submit.type = 'button';
      submit.textContent = 'Try Tool';
      submit.onclick = async () => {
        const payload = {};
        for (const [key, meta] of Object.entries(fields)) {
          const raw = meta.input.value.trim();
          if (!raw) {
            if (meta.required) {
              alert(`Missing required field: ${key}`);
              return;
            }
            continue;
          }
          if (['object', 'array'].includes(meta.schema.type)) {
            try {
              payload[key] = JSON.parse(raw);
            } catch (e) {
              alert(`Invalid JSON for ${key}`);
              return;
            }
          } else if (meta.schema.type === 'integer') {
            payload[key] = Number.parseInt(raw, 10);
          } else if (meta.schema.type === 'number') {
            payload[key] = Number(raw);
          } else if (meta.schema.type === 'boolean') {
            payload[key] = raw.toLowerCase() === 'true';
          } else {
            payload[key] = raw;
          }
        }
        const resp = await fetch(tool.path, {
          method: tool.method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        state.tryResult = await resp.json();
        result.textContent = JSON.stringify(state.tryResult, null, 2);
        loadData();
      };
      formContainer.appendChild(submit);
    };

    select.onchange = renderToolForm;
    renderToolForm();

    panel.innerHTML = card('Tool Form', '');
    const toolCard = panel.querySelector('.card');
    if (toolCard) {
      toolCard.append(select, formContainer, result);
    }
    return;
  }

  if (state.activeTab === 'Processes') {
    const items = data.processes?.items || [];
    panel.innerHTML = card('Active/Tracked Processes', `<pre>${JSON.stringify(items, null, 2)}</pre>`);
    return;
  }

  if (state.activeTab === 'Logs') {
    const history = data.history || { items: [], total: 0, offset: 0, limit: 10 };
    panel.innerHTML = card('Recent Tool Calls', `<pre>${JSON.stringify(history.items, null, 2)}</pre><p class="muted">offset=${history.offset} limit=${history.limit} total=${history.total}</p>`);
    const pager = renderHistoryPager(history.offset, history.limit, history.total,
      () => { state.historyOffset = Math.max(0, state.historyOffset - state.historyLimit); loadData(); },
      () => { state.historyOffset = state.historyOffset + state.historyLimit; loadData(); },
    );
    panel.appendChild(pager);
    return;
  }

  if (state.activeTab === 'Policy') {
    const policy = data.policy_denials || { items: [], total: 0, offset: 0, limit: 10 };
    panel.innerHTML = card('Policy Denials', `<pre>${JSON.stringify(policy.items, null, 2)}</pre><p class="muted">offset=${policy.offset} limit=${policy.limit} total=${policy.total}</p>`);
    const pager = renderHistoryPager(policy.offset, policy.limit, policy.total,
      () => { state.policyOffset = Math.max(0, state.policyOffset - state.policyLimit); loadData(); },
      () => { state.policyOffset = state.policyOffset + state.policyLimit; loadData(); },
    );
    panel.appendChild(pager);
  }
}

renderTabs();
loadData();
