let todoTasks = [];
let doneTasks = [];
let masterCategories = [];
let currentView = 'todo';
let todoFilter = 'work';
let todoCategoryFilter = '';
let doneTimeFilter = 'today';
let doneTypeFilter = null;
let doneCategoryFilter = '';
let selectedTodoIds = new Set();
let lastRenderedTodo = [];
let lastRenderedDone = [];

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_ABBREV = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localIso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function today() {
  return localIso(new Date());
}

function parseDate(dueStr) {
  if (!dueStr) return null;
  const clean = dueStr.replace(/ EOD$/, '').replace(/ first thing$/, '').replace(/ first$/, '');
  const m = clean.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  return null;
}

function shortDue(dueStr) {
  if (!dueStr) return '';
  const d = parseDate(dueStr);
  if (!d) return dueStr;
  const dt = new Date(d + 'T00:00:00');
  let suffix = '';
  if (dueStr.includes('first thing')) suffix = ' first thing';
  else if (dueStr.includes('EOD')) suffix = ' EOD';
  return MONTH_ABBREV[dt.getMonth()] + ' ' + dt.getDate() + suffix;
}

function classifyTask(task) {
  const t = today();
  const d = parseDate(task.due);
  if (!d) return 'later';
  if (d < t) return 'overdue';
  if (d === t) return 'today';

  const now = new Date(t + 'T00:00:00');
  const due = new Date(d + 'T00:00:00');
  const dayOfWeek = now.getDay();
  const daysToFriday = (5 - dayOfWeek + 7) % 7;
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + daysToFriday);
  const endStr = localIso(endOfWeek);

  if (d <= endStr) return 'week';
  return 'later';
}

function isPersonal(task) {
  return task.personal === true || (task.category || '').toLowerCase() === 'personal';
}

function typeBadge(type) {
  if (!type) return '';
  const cls = 'type-' + type;
  const label = type.charAt(0).toUpperCase();
  return `<span class="type-badge ${cls}">${label}</span>`;
}

// Modal
function showModal(message, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const msg = document.getElementById('modal-message');
    const inputWrap = document.getElementById('modal-input-wrap');
    const input = document.getElementById('modal-input');
    const dateWrap = document.getElementById('modal-date-wrap');
    const dateInput = document.getElementById('modal-date');
    const confirm = document.getElementById('modal-confirm');
    const cancel = document.getElementById('modal-cancel');

    msg.textContent = message;

    inputWrap.classList.add('hidden');
    dateWrap.classList.add('hidden');

    if (options.date) {
      dateWrap.classList.remove('hidden');
      dateInput.value = options.dateValue || '';
    } else if (options.input) {
      inputWrap.classList.remove('hidden');
      input.placeholder = options.inputPlaceholder || '';
      input.value = options.inputValue || '';
    }

    overlay.classList.remove('hidden');

    function cleanup() {
      overlay.classList.add('hidden');
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
    }

    function onConfirm() {
      cleanup();
      resolve(options.date ? dateInput.value : options.input ? input.value : true);
    }

    function onCancel() {
      cleanup();
      resolve(options.date ? null : options.input ? null : false);
    }

    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);

    if (options.date) {
      dateInput.focus();
    } else if (options.input) {
      input.focus();
      input.addEventListener('keydown', function handler(e) {
        if (e.key === 'Enter') { onConfirm(); input.removeEventListener('keydown', handler); }
        if (e.key === 'Escape') { onCancel(); input.removeEventListener('keydown', handler); }
      });
    }
  });
}

// API helpers
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

function populateCategoryDropdown(selectId, tasks) {
  const sel = document.getElementById(selectId);
  const current = sel.value;
  const cats = [...new Set(tasks.map(t => t.category || 'Other'))].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  sel.innerHTML = '<option value="">All Categories</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

const categoryListenersAdded = new Set();

function populateAddCategoryDropdown(selectId, customInputId, personalOnly) {
  const filtered = masterCategories.filter(c => personalOnly ? c.personal : !c.personal);

  const sel = document.getElementById(selectId);
  const current = sel.value;
  const customInput = document.getElementById(customInputId);
  sel.innerHTML = '<option value="">Category...</option>';
  filtered.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    if (c.name === current) opt.selected = true;
    sel.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New category...';
  if (current === '__new__') newOpt.selected = true;
  sel.appendChild(newOpt);

  if (!categoryListenersAdded.has(selectId)) {
    categoryListenersAdded.add(selectId);
    sel.addEventListener('change', function () {
      if (this.value === '__new__') {
        customInput.classList.remove('hidden');
        customInput.focus();
      } else {
        customInput.classList.add('hidden');
        customInput.value = '';
      }
    });
  }
}

function refreshAddCategoryDropdowns() {
  const todoPersonal = document.getElementById('new-todo-personal').checked;
  const donePersonal = document.getElementById('new-done-personal').checked;
  populateAddCategoryDropdown('new-todo-category-select', 'new-todo-category-custom', todoPersonal);
  populateAddCategoryDropdown('new-done-category-select', 'new-done-category-custom', donePersonal);
}

async function getSelectedCategory(selectId, customInputId, personal) {
  const sel = document.getElementById(selectId);
  const custom = document.getElementById(customInputId);
  if (sel.value === '__new__') {
    const name = custom.value.trim() || 'Other';
    if (name !== 'Other' && !masterCategories.some(c => c.name === name)) {
      await api('/api/categories', 'POST', { name, personal: !!personal });
      masterCategories = await api('/api/categories');
      refreshAddCategoryDropdowns();
    }
    return name;
  }
  return sel.value || 'Other';
}

function resetCategorySelect(selectId, customInputId) {
  document.getElementById(selectId).value = '';
  document.getElementById(customInputId).value = '';
  document.getElementById(customInputId).classList.add('hidden');
}

async function loadTodo() {
  todoTasks = await api('/api/todo');
  populateCategoryDropdown('todo-category-filter', todoTasks);
  refreshAddCategoryDropdowns();
  renderTodo();
}

async function loadDone() {
  doneTasks = await api('/api/done');
  populateCategoryDropdown('done-category-filter', doneTasks);
  refreshAddCategoryDropdowns();
  renderDone();
}

// Inline edit handler
function makeEditable(td, taskId, field, listType) {
  td.setAttribute('contenteditable', 'true');
  td.addEventListener('blur', async function () {
    const newValue = this.textContent.trim();
    const url = listType === 'todo' ? `/api/todo/${taskId}` : `/api/done/${taskId}`;
    await api(url, 'PUT', { [field]: newValue });
    if (listType === 'todo') await loadTodo();
    else await loadDone();
  });
  td.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (listType === 'todo') loadTodo();
      else loadDone();
    }
  });
}

function makeTypeSelect(td, task, listType) {
  const sel = document.createElement('select');
  sel.className = 'cell-select';
  ['quick', 'deep', 'meeting', 'errands'].forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v || '—';
    if ((task.type || '') === v) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', async function () {
    const url = listType === 'done' ? `/api/done/${task.id}` : `/api/todo/${task.id}`;
    await api(url, 'PUT', { type: this.value });
    if (listType === 'done') await loadDone();
    else await loadTodo();
  });
  td.appendChild(sel);
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-actions');
  const count = document.getElementById('bulk-count');
  if (selectedTodoIds.size > 0) {
    bar.classList.remove('hidden');
    count.textContent = `${selectedTodoIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
}

// Render To Do
function renderTodo() {
  const container = document.getElementById('todo-groups');
  container.innerHTML = '';

  let filtered = todoTasks;
  if (todoFilter === 'work') filtered = filtered.filter(t => !isPersonal(t));
  else if (todoFilter === 'personal') filtered = filtered.filter(t => isPersonal(t));
  if (todoCategoryFilter) filtered = filtered.filter(t => (t.category || '') === todoCategoryFilter);
  lastRenderedTodo = filtered;

  const groups = { priority: [], overdue: [], today: [], week: [], later: [] };
  filtered.forEach(t => {
    if (t.priority) {
      groups.priority.push(t);
    } else {
      const cat = classifyTask(t);
      groups[cat].push(t);
    }
  });

  const sortKey = (a, b) => {
    const da = parseDate(a.due) || '2099-12-31';
    const db = parseDate(b.due) || '2099-12-31';
    if (da !== db) return da.localeCompare(db);
    const fa = (a.due || '').includes('first thing') ? 0 : 1;
    const fb = (b.due || '').includes('first thing') ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return a.id - b.id;
  };

  Object.values(groups).forEach(g => g.sort(sortKey));

  const banner = document.getElementById('overdue-banner');
  const overdueCount = groups.overdue.length;
  if (overdueCount > 0) {
    const nextMon = new Date();
    const dow = nextMon.getDay();
    const daysUntilMon = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
    nextMon.setDate(nextMon.getDate() + daysUntilMon);
    const monIso = localIso(nextMon);

    banner.innerHTML = '';
    const msg = document.createElement('span');
    msg.textContent = `${overdueCount} overdue task${overdueCount > 1 ? 's' : ''}`;
    const btn = document.createElement('button');
    btn.textContent = 'Move all';
    btn.addEventListener('click', async () => {
      const picked = await showModal(`Move ${overdueCount} overdue task${overdueCount > 1 ? 's' : ''} to:`, {
        date: true, dateValue: monIso
      });
      if (!picked) return;
      const dt = new Date(picked + 'T00:00:00');
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const newDue = dayNames[dt.getDay()] + ' ' + picked;
      for (const t of groups.overdue) {
        await api(`/api/todo/${t.id}`, 'PUT', { due: newDue });
      }
      await loadTodo();
    });
    banner.appendChild(msg);
    banner.appendChild(btn);
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  const labels = { priority: 'Top Priority', overdue: 'Overdue', today: 'Due Today', week: 'This Week', later: 'Later' };
  let totalShown = 0;

  for (const [key, tasks] of Object.entries(groups)) {
    if (tasks.length === 0) continue;
    totalShown += tasks.length;

    const header = document.createElement('div');
    header.className = 'group-header' + (key === 'priority' ? ' priority' : '') + (key === 'overdue' ? ' overdue' : '') + (key === 'today' ? ' today' : '');
    header.textContent = `${labels[key]} (${tasks.length})`;
    container.appendChild(header);

    const table = document.createElement('table');
    table.innerHTML = `<thead><tr>
      <th></th><th>Category</th><th>Task</th><th>Type</th><th>Due</th><th>Notes</th><th title="Personal">P</th><th>Actions</th>
    </tr></thead>`;
    const tbody = document.createElement('tbody');

    tasks.forEach(task => {
      const tr = document.createElement('tr');
      if (selectedTodoIds.has(task.id)) tr.classList.add('selected');
      if (isPersonal(task)) tr.classList.add('personal-row');
      const isMustHave = (task.notes || '').toLowerCase().includes('must have');

      const tdCheck = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.checked = selectedTodoIds.has(task.id);
      checkbox.addEventListener('change', function () {
        if (this.checked) selectedTodoIds.add(task.id);
        else selectedTodoIds.delete(task.id);
        tr.classList.toggle('selected', this.checked);
        updateBulkBar();
      });
      tdCheck.appendChild(checkbox);
      tr.appendChild(tdCheck);

      const tdCat = document.createElement('td');
      tdCat.textContent = task.category || '';
      makeEditable(tdCat, task.id, 'category', 'todo');
      tr.appendChild(tdCat);

      const tdTask = document.createElement('td');
      tdTask.textContent = task.task || '';
      if (isMustHave) tdTask.classList.add('must-have');
      makeEditable(tdTask, task.id, 'task', 'todo');
      tr.appendChild(tdTask);

      const tdType = document.createElement('td');
      makeTypeSelect(tdType, task, 'todo');
      tr.appendChild(tdType);

      const tdDue = document.createElement('td');
      const dateInput = document.createElement('input');
      dateInput.type = 'date';
      dateInput.className = 'date-input';
      const dateVal = parseDate(task.due);
      if (dateVal) dateInput.value = dateVal;
      dateInput.addEventListener('change', async function () {
        const suffix = (task.due || '').includes('first thing') ? ' first thing' : (task.due || '').includes('EOD') ? ' EOD' : '';
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dt = new Date(this.value + 'T00:00:00');
        const newDue = dayNames[dt.getDay()] + ' ' + this.value + suffix;
        await api(`/api/todo/${task.id}`, 'PUT', { due: newDue });
        await loadTodo();
      });
      tdDue.appendChild(dateInput);
      tr.appendChild(tdDue);

      const tdNotes = document.createElement('td');
      const noteVal = task.notes || '';
      if (noteVal && /^https?:\/\/\S+$/i.test(noteVal)) {
        tdNotes.className = 'note-link';
        const link = document.createElement('a');
        link.href = noteVal;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = noteVal;
        tdNotes.appendChild(link);
        tdNotes.addEventListener('dblclick', function () {
          this.textContent = noteVal;
          this.setAttribute('contenteditable', 'true');
          this.focus();
          const onBlur = async () => {
            this.removeEventListener('blur', onBlur);
            const newValue = this.textContent.trim();
            await api(`/api/todo/${task.id}`, 'PUT', { notes: newValue });
            await loadTodo();
          };
          this.addEventListener('blur', onBlur);
        });
      } else {
        tdNotes.textContent = noteVal;
        makeEditable(tdNotes, task.id, 'notes', 'todo');
      }
      tr.appendChild(tdNotes);

      const tdPersonal = document.createElement('td');
      const personalCheck = document.createElement('input');
      personalCheck.type = 'checkbox';
      personalCheck.className = 'task-checkbox';
      personalCheck.checked = isPersonal(task);
      personalCheck.addEventListener('change', async function () {
        await api(`/api/todo/${task.id}`, 'PUT', { personal: this.checked });
        await loadTodo();
      });
      tdPersonal.appendChild(personalCheck);
      tr.appendChild(tdPersonal);

      const tdActions = document.createElement('td');
      tdActions.className = 'actions';

      const prioBtn = document.createElement('button');
      prioBtn.className = task.priority ? 'btn btn-priority active' : 'btn btn-priority';
      prioBtn.textContent = task.priority ? '★' : '☆';
      prioBtn.title = task.priority ? 'Remove top priority' : 'Mark as top priority';
      prioBtn.addEventListener('click', async () => {
        await api(`/api/todo/${task.id}`, 'PUT', { priority: !task.priority });
        await loadTodo();
      });
      tdActions.appendChild(prioBtn);

      const doneBtn = document.createElement('button');
      doneBtn.className = 'btn btn-done';
      doneBtn.textContent = 'Done';
      doneBtn.addEventListener('click', async () => {
        const reflection = await showModal(`Mark "${task.task}" as done?`, {
          input: true, inputPlaceholder: 'How did it feel? (optional)'
        });
        if (reflection !== null) {
          await api(`/api/todo/${task.id}/done`, 'POST', { reflection: reflection || '' });
          await loadTodo();
          await loadDone();
        }
      });
      tdActions.appendChild(doneBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-delete';
      delBtn.textContent = 'Del';
      delBtn.addEventListener('click', async () => {
        const confirmed = await showModal(`Delete "${task.task}"?`);
        if (confirmed) {
          await api(`/api/todo/${task.id}`, 'DELETE');
          await loadTodo();
        }
      });
      tdActions.appendChild(delBtn);

      tr.appendChild(tdActions);
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  }

  const summary = document.createElement('div');
  summary.className = 'summary';
  const counts = [];
  if (groups.priority.length) counts.push(`${groups.priority.length} top priority`);
  if (groups.overdue.length) counts.push(`${groups.overdue.length} overdue`);
  if (groups.today.length) counts.push(`${groups.today.length} today`);
  if (groups.week.length) counts.push(`${groups.week.length} this week`);
  if (groups.later.length) counts.push(`${groups.later.length} later`);
  summary.textContent = `${counts.join(', ')}. ${totalShown} total.`;
  if (todoFilter === 'work') {
    const hidden = todoTasks.filter(t => isPersonal(t)).length;
    if (hidden) summary.textContent += ` (${hidden} personal hidden)`;
  }
  container.appendChild(summary);
}

function renderDoneTable(container, tasks, showDate) {
  const table = document.createElement('table');
  let headerHtml = '<thead><tr><th>Category</th><th>Task</th><th>Type</th>';
  if (showDate) headerHtml += '<th>Date</th>';
  headerHtml += '<th>Reflection</th><th class="done-notes-th">Notes</th><th title="Personal">P</th><th>Actions</th></tr></thead>';
  table.innerHTML = headerHtml;
  const tbody = document.createElement('tbody');

  tasks.forEach(task => {
    const tr = document.createElement('tr');
    if (isPersonal(task)) tr.classList.add('personal-row');

    const tdCat = document.createElement('td');
    tdCat.textContent = task.category || '';
    makeEditable(tdCat, task.id, 'category', 'done');
    tr.appendChild(tdCat);

    const tdTask = document.createElement('td');
    tdTask.className = 'done-task-col';
    tdTask.textContent = task.task || '';
    makeEditable(tdTask, task.id, 'task', 'done');
    tr.appendChild(tdTask);

    const tdType = document.createElement('td');
    tdType.className = 'done-type-col';
    makeTypeSelect(tdType, task, 'done');
    tr.appendChild(tdType);

    if (showDate) {
      const tdDate = document.createElement('td');
      if (task.date) {
        const dt = new Date(task.date + 'T00:00:00');
        const wd = (task.weekDay || '').substring(0, 3);
        tdDate.textContent = `${wd} ${MONTH_ABBREV[dt.getMonth()]} ${dt.getDate()}`;
      }
      tr.appendChild(tdDate);
    }

    const tdReflection = document.createElement('td');
    tdReflection.textContent = task.reflection || '';
    makeEditable(tdReflection, task.id, 'reflection', 'done');
    tr.appendChild(tdReflection);

    const tdNotes = document.createElement('td');
    const noteVal = task.notes || '';
    tdNotes.className = (noteVal && /^https?:\/\/\S+$/i.test(noteVal)) ? 'done-notes-col note-link' : 'done-notes-col';
    if (noteVal && /^https?:\/\/\S+$/i.test(noteVal)) {
      const link = document.createElement('a');
      link.href = noteVal;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = noteVal;
      tdNotes.appendChild(link);
      tdNotes.addEventListener('dblclick', function () {
        this.textContent = noteVal;
        this.setAttribute('contenteditable', 'true');
        this.focus();
        const onBlur = async () => {
          this.removeEventListener('blur', onBlur);
          const newValue = this.textContent.trim();
          await api(`/api/done/${task.id}`, 'PUT', { notes: newValue });
          await loadDone();
        };
        this.addEventListener('blur', onBlur);
      });
    } else {
      tdNotes.textContent = noteVal;
      makeEditable(tdNotes, task.id, 'notes', 'done');
    }
    tr.appendChild(tdNotes);

    const tdPersonal = document.createElement('td');
    const personalCheck = document.createElement('input');
    personalCheck.type = 'checkbox';
    personalCheck.className = 'task-checkbox';
    personalCheck.checked = isPersonal(task);
    personalCheck.addEventListener('change', async function () {
      await api(`/api/done/${task.id}`, 'PUT', { personal: this.checked });
      await loadDone();
    });
    tdPersonal.appendChild(personalCheck);
    tr.appendChild(tdPersonal);

    const tdActions = document.createElement('td');
    tdActions.className = 'actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-delete';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', async () => {
      const confirmed = await showModal(`Delete "${task.task}" from done list?`);
      if (confirmed) {
        await api(`/api/done/${task.id}`, 'DELETE');
        await loadDone();
      }
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);
}

// Render Done
function renderDone() {
  const container = document.getElementById('done-list');
  container.innerHTML = '';

  let filtered = doneTasks;

  const t = today();
  if (doneTimeFilter === 'today') {
    filtered = filtered.filter(d => d.date === t);
  } else if (doneTimeFilter === 'week') {
    const now = new Date(t + 'T00:00:00');
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const startStr = localIso(monday);
    const endStr = localIso(sunday);
    filtered = filtered.filter(d => d.date >= startStr && d.date <= endStr);
  }

  if (doneTypeFilter === 'work') {
    filtered = filtered.filter(d => !isPersonal(d));
  } else if (doneTypeFilter === 'personal') {
    filtered = filtered.filter(d => isPersonal(d));
  }
  if (doneCategoryFilter) filtered = filtered.filter(d => (d.category || '') === doneCategoryFilter);
  lastRenderedDone = filtered;

  filtered.sort((a, b) => {
    const da = a.date || '';
    const db = b.date || '';
    if (da !== db) return db.localeCompare(da);
    return b.id - a.id;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="summary">No completed tasks to show.</div>';
    return;
  }

  const showDate = doneTimeFilter !== 'today';

  function getWeekKey(dateStr) {
    if (!dateStr) return 'Unknown';
    const dt = new Date(dateStr + 'T00:00:00');
    const day = dt.getDay();
    const monday = new Date(dt);
    monday.setDate(dt.getDate() - ((day + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return localIso(monday) + '|' + localIso(sunday);
  }

  function formatWeekLabel(weekKey) {
    if (weekKey === 'Unknown') return 'Unknown Date';
    const [monStr, sunStr] = weekKey.split('|');
    const mon = new Date(monStr + 'T00:00:00');
    const sun = new Date(sunStr + 'T00:00:00');
    const t = today();
    const tDate = new Date(t + 'T00:00:00');
    const tDay = tDate.getDay();
    const thisMon = new Date(tDate);
    thisMon.setDate(tDate.getDate() - ((tDay + 6) % 7));
    const thisMonStr = localIso(thisMon);
    let prefix = '';
    if (monStr === thisMonStr) prefix = 'This Week: ';
    else {
      const lastMon = new Date(thisMon);
      lastMon.setDate(thisMon.getDate() - 7);
      if (monStr === localIso(lastMon)) prefix = 'Last Week: ';
    }
    return `${prefix}${MONTH_ABBREV[mon.getMonth()]} ${mon.getDate()} - ${MONTH_ABBREV[sun.getMonth()]} ${sun.getDate()}`;
  }

  const weekGroups = new Map();
  filtered.forEach(task => {
    const key = getWeekKey(task.date);
    if (!weekGroups.has(key)) weekGroups.set(key, []);
    weekGroups.get(key).push(task);
  });

  const useWeekGroups = doneTimeFilter === 'all';

  if (useWeekGroups) {
    for (const [weekKey, tasks] of weekGroups) {
      const header = document.createElement('div');
      header.className = 'group-header week-group-header';
      header.textContent = `${formatWeekLabel(weekKey)} (${tasks.length})`;
      header.style.cursor = 'pointer';
      const tableWrap = document.createElement('div');

      header.addEventListener('click', () => {
        tableWrap.classList.toggle('hidden');
      });

      container.appendChild(header);
      renderDoneTable(tableWrap, tasks, true);
      container.appendChild(tableWrap);
    }
  } else {
    renderDoneTable(container, filtered, showDate);
  }

  const work = filtered.filter(d => !isPersonal(d)).length;
  const personal = filtered.filter(d => isPersonal(d)).length;
  const summary = document.createElement('div');
  summary.className = 'summary';
  const parts = [];
  if (work) parts.push(`${work} work`);
  if (personal) parts.push(`${personal} personal`);
  summary.textContent = `${parts.join(' + ')} = ${filtered.length} items.`;
  container.appendChild(summary);
}

// Tab switching
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(currentView + '-view').classList.add('active');
  });
});

// Todo filters
document.querySelectorAll('#todo-view .filters .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#todo-view .filters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    todoFilter = btn.dataset.filter;
    renderTodo();
  });
});

// Done filters
document.querySelectorAll('#done-view .toolbar').forEach(toolbar => {
  toolbar.querySelectorAll('.filters').forEach((filterGroup, idx) => {
    filterGroup.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (idx === 0) {
          filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          doneTimeFilter = btn.dataset.filter;
        } else {
          if (btn.classList.contains('active')) {
            btn.classList.remove('active');
            doneTypeFilter = null;
          } else {
            filterGroup.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            doneTypeFilter = btn.dataset.filter;
          }
        }
        renderDone();
      });
    });
  });
});

// Category filters
document.getElementById('todo-category-filter').addEventListener('change', function () {
  todoCategoryFilter = this.value;
  renderTodo();
});

document.getElementById('done-category-filter').addEventListener('change', function () {
  doneCategoryFilter = this.value;
  renderDone();
});

// Personal checkbox toggles category dropdown
document.getElementById('new-todo-personal').addEventListener('change', function () {
  populateAddCategoryDropdown('new-todo-category-select', 'new-todo-category-custom', this.checked);
});
document.getElementById('new-done-personal').addEventListener('change', function () {
  populateAddCategoryDropdown('new-done-category-select', 'new-done-category-custom', this.checked);
});

// Add Todo
document.getElementById('save-todo-btn').addEventListener('click', async () => {
  const personal = document.getElementById('new-todo-personal').checked;
  const category = await getSelectedCategory('new-todo-category-select', 'new-todo-category-custom', personal);
  const task = document.getElementById('new-todo-task').value.trim();
  const due = document.getElementById('new-todo-due').value.trim();
  const type = document.getElementById('new-todo-type').value;
  const notes = document.getElementById('new-todo-notes').value.trim();

  if (!task) return;

  const newTask = { category, task, personal };
  if (due) newTask.due = due;
  if (type) newTask.type = type;
  if (notes) newTask.notes = notes;

  await api('/api/todo', 'POST', newTask);
  await loadTodo();

  resetCategorySelect('new-todo-category-select', 'new-todo-category-custom');
  document.getElementById('new-todo-task').value = '';
  document.getElementById('new-todo-notes').value = '';
  document.getElementById('new-todo-personal').checked = false;
  document.getElementById('new-todo-due').value = today();
  document.getElementById('new-todo-type').value = 'quick';
});

// Add Done
document.getElementById('save-done-btn').addEventListener('click', async () => {
  const personal = document.getElementById('new-done-personal').checked;
  const category = await getSelectedCategory('new-done-category-select', 'new-done-category-custom', personal);
  const task = document.getElementById('new-done-task').value.trim();
  const dateVal = document.getElementById('new-done-date').value;
  const type = document.getElementById('new-done-type').value;
  const reflection = document.getElementById('new-done-reflection').value.trim();

  if (!task) return;

  const newTask = { category, task, personal };
  if (type) newTask.type = type;
  if (reflection) newTask.reflection = reflection;
  if (dateVal) {
    const dt = new Date(dateVal + 'T00:00:00');
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    newTask.date = dateVal;
    newTask.completedOn = dateVal;
    newTask.weekDay = dayNames[dt.getDay()];
  }

  await api('/api/done', 'POST', newTask);
  await loadDone();

  resetCategorySelect('new-done-category-select', 'new-done-category-custom');
  document.getElementById('new-done-task').value = '';
  document.getElementById('new-done-date').value = '';
  document.getElementById('new-done-reflection').value = '';
  document.getElementById('new-done-type').value = 'meeting';
  document.getElementById('new-done-personal').checked = false;
  document.getElementById('new-done-date').value = today();
});

// Bulk move
document.getElementById('bulk-move-btn').addEventListener('click', async () => {
  const dateVal = document.getElementById('bulk-move-date').value;
  if (!dateVal) return;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dt = new Date(dateVal + 'T00:00:00');
  const newDue = dayNames[dt.getDay()] + ' ' + dateVal;

  for (const id of selectedTodoIds) {
    await api(`/api/todo/${id}`, 'PUT', { due: newDue });
  }
  selectedTodoIds.clear();
  updateBulkBar();
  await loadTodo();
});

document.getElementById('bulk-clear-btn').addEventListener('click', () => {
  selectedTodoIds.clear();
  updateBulkBar();
  renderTodo();
});

// CSV export
function escapeCsv(val) {
  const s = String(val || '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportTodoCsv() {
  const headers = ['Category', 'Task', 'Type', 'Due', 'Notes', 'Priority'];
  const rows = lastRenderedTodo.map(t => [
    t.category || '', t.task || '', t.type || '', shortDue(t.due), t.notes || '', t.priority ? 'Yes' : ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
  downloadCsv(csv, 'todo.csv');
}

function exportDoneCsv() {
  const headers = ['Day', 'Task', 'Category', 'Note', 'Reflection', 'Date'];
  const rows = lastRenderedDone.map(t => [
    t.weekDay || '', t.task || '', t.category || '', t.notes || '', t.reflection || '', t.date || ''
  ]);
  const csv = [headers, ...rows].map(r => r.map(escapeCsv).join(',')).join('\n');
  downloadCsv(csv, 'done.csv');
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('export-todo-btn').addEventListener('click', exportTodoCsv);
document.getElementById('export-done-btn').addEventListener('click', exportDoneCsv);

function copyToKeepTodo() {
  const lines = lastRenderedTodo.map(t => {
    const cat = t.category ? `[${t.category}] ` : '';
    const due = shortDue(t.due);
    const dueStr = due ? ` (${due})` : '';
    return `${cat}${t.task}${dueStr}`;
  });
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    document.getElementById('copy-todo-keep').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-todo-keep').textContent = 'Copy for Keep'; }, 1500);
  });
}

function copyToKeepDone() {
  const lines = lastRenderedDone.map(t => {
    const cat = t.category ? `[${t.category}] ` : '';
    const feel = t.reflection ? ` — ${t.reflection}` : '';
    return `${cat}${t.task}${feel}`;
  });
  navigator.clipboard.writeText(lines.join('\n')).then(() => {
    document.getElementById('copy-done-keep').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('copy-done-keep').textContent = 'Copy for Keep'; }, 1500);
  });
}

document.getElementById('copy-todo-keep').addEventListener('click', copyToKeepTodo);
document.getElementById('copy-done-keep').addEventListener('click', copyToKeepDone);

// Categories management
let catViewFilter = 'work';

async function loadCategories() {
  masterCategories = await api('/api/categories');
}

function renderCategories() {
  const container = document.getElementById('categories-list');
  container.innerHTML = '';

  let filtered = masterCategories;
  if (catViewFilter === 'work') filtered = masterCategories.filter(c => !c.personal);
  else if (catViewFilter === 'personal') filtered = masterCategories.filter(c => c.personal);

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Category</th><th title="Personal">P</th><th>Actions</th></tr></thead>';
  const tbody = document.createElement('tbody');

  filtered.forEach(cat => {
    const tr = document.createElement('tr');
    if (cat.personal) tr.classList.add('personal-row');

    const tdName = document.createElement('td');
    tdName.textContent = cat.name;
    tdName.setAttribute('contenteditable', 'true');
    tdName.addEventListener('blur', async function () {
      const newName = this.textContent.trim();
      if (newName && newName !== cat.name) {
        await api(`/api/categories/${encodeURIComponent(cat.name)}`, 'PUT', { name: newName });
        await loadCategories();
        renderCategories();
        await loadTodo();
        await loadDone();
      }
    });
    tdName.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); this.blur(); }
    });
    tr.appendChild(tdName);

    const tdPersonal = document.createElement('td');
    const pCheck = document.createElement('input');
    pCheck.type = 'checkbox';
    pCheck.className = 'task-checkbox';
    pCheck.checked = cat.personal;
    pCheck.addEventListener('change', async function () {
      await api(`/api/categories/${encodeURIComponent(cat.name)}`, 'PUT', { personal: this.checked });
      await loadCategories();
      renderCategories();
    });
    tdPersonal.appendChild(pCheck);
    tr.appendChild(tdPersonal);

    const tdActions = document.createElement('td');
    tdActions.className = 'actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-delete';
    delBtn.textContent = 'Del';
    delBtn.addEventListener('click', async () => {
      const confirmed = await showModal(`Delete category "${cat.name}"? Tasks using it will keep their category but it won't appear in dropdowns.`);
      if (confirmed) {
        await api(`/api/categories/${encodeURIComponent(cat.name)}`, 'DELETE');
        await loadCategories();
        renderCategories();
      }
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);

  const work = masterCategories.filter(c => !c.personal).length;
  const personal = masterCategories.filter(c => c.personal).length;
  const summary = document.createElement('div');
  summary.className = 'summary';
  summary.textContent = `${work} work + ${personal} personal = ${masterCategories.length} categories.`;
  container.appendChild(summary);
}

document.querySelectorAll('#categories-view .filters .filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#categories-view .filters .filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    catViewFilter = btn.dataset.filter;
    renderCategories();
  });
});

document.getElementById('add-category-btn').addEventListener('click', async () => {
  const input = document.getElementById('new-category-name');
  const personal = document.getElementById('new-category-personal').checked;
  const name = input.value.trim();
  if (!name) return;
  await api('/api/categories', 'POST', { name, personal });
  await loadCategories();
  renderCategories();
  input.value = '';
  document.getElementById('new-category-personal').checked = false;
});

document.getElementById('new-category-name').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') document.getElementById('add-category-btn').click();
});

// Initial load
async function init() {
  await loadCategories();
  await Promise.all([loadTodo(), loadDone()]);
  renderCategories();
  document.getElementById('new-todo-due').value = today();
  document.getElementById('new-todo-type').value = 'quick';
  document.getElementById('new-done-date').value = today();
}
init();
